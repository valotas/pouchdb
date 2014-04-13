#!/usr/bin/env node
'use strict';

var path = require('path');
var spawn = require('child_process').spawn;

var request = require('request');
var wd = require('wd');
var sauceConnectLauncher = require('sauce-connect-launcher');
var querystring = require("querystring");
var devserver = require('./dev-server.js');

var SELENIUM_PATH = '../vendor/selenium-server-standalone-2.38.0.jar';
var SELENIUM_HUB = 'http://localhost:4444/wd/hub/status';

var testRoot = 'http://127.0.0.1:8000/tests/';
var testUrl = testRoot +
  (process.env.PERF ? 'performance/test.html' : 'test.html');

var testTimeout = 30 * 60 * 1000;

var username = process.env.SAUCE_USERNAME;
var accessKey = process.env.SAUCE_ACCESS_KEY;
var browser = process.env.CLIENT || 'firefox';
var client;
var qs = {};

var sauceConnectProcess;
var tunnelId = process.env.TRAVIS_JOB_NUMBER || 'tunnel-' + Date.now();

if (process.env.GREP) {
  qs.grep = process.env.GREP;
}
if (process.env.NATIVEPROMISE) {
  qs.noBluebird = 1;
}
if (process.env.LEVEL_BACKEND) {
  qs.sourceFile = "pouchdb-" + process.env.LEVEL_BACKEND + ".js";
}
testUrl += '?';
testUrl += querystring.stringify(qs);

if (process.env.TRAVIS &&
    browser !== 'firefox' &&
    process.env.TRAVIS_SECURE_ENV_VARS === 'false') {
  console.error('Not running test, cannot connect to saucelabs');
  process.exit(0);
  return;
}

function testError(e) {
  console.error(e);
  console.error('Doh, tests failed');
  client.quit();
  process.exit(3);
}

function postResult(result) {
  if (process.env.PERF && process.env.DASHBOARD_HOST) {
    var options = {
      method: 'POST',
      uri: process.env.DASHBOARD_HOST + '/performance_results',
      json: result
    };
    request(options, function (error, response, body) {
      process.exit(!!error);
    });
    return;
  }
  process.exit(!process.env.PERF && result.failed ? 1 : 0);
}

function testComplete(result) {
  result.date = Date.now();
  console.log(result);

  client.quit().then(function () {
    if (sauceConnectProcess) {
      sauceConnectProcess.close(function () {
        postResult(result);
      });
    } else {
      postResult(result);
    }
  });
}

function startSelenium(callback) {

  // Start selenium
  spawn('java', ['-jar', path.resolve(__dirname, SELENIUM_PATH)], {});

  var retries = 0;
  var started = function () {

    if (++retries > 30) {
      console.error('Unable to connect to selenium');
      process.exit(1);
      return;
    }

    request(SELENIUM_HUB, function (err, resp) {
      if (resp && resp.statusCode === 200) {
        client = wd.promiseChainRemote();
        callback();
      } else {
        setTimeout(started, 1000);
      }
    });
  };

  started();

}

function startSauceConnect(callback) {

  var options = {
    username: username,
    accessKey: accessKey,
    tunnelIdentifier: tunnelId
  };

  sauceConnectLauncher(options, function (err, process) {
    if (err) {
      console.error('Failed to connect to saucelabs');
      console.error(err);
      return process.exit(1);
    }
    sauceConnectProcess = process;
    client = wd.promiseChainRemote("localhost", 4445, username, accessKey);
    callback();
  });
}

function startTest() {

  console.log('Starting', browser);

  var opts = {
    browserName: browser,
    tunnelTimeout: testTimeout,
    name: browser + ' - ' + tunnelId,
    'max-duration': 60 * 30,
    'command-timeout': 599,
    'idle-timeout': 599,
    'tunnel-identifier': tunnelId
  };

  client.init(opts).get(testUrl, function () {

    /* jshint evil: true */
    var interval = setInterval(function () {
      client.eval('window.results', function (err, results) {
        if (err) {
          clearInterval(interval);
          testError(err);
        } else if (results.completed || results.failures.length) {
          clearInterval(interval);
          testComplete(results);
        } else {
          console.log('=> ', results);
        }
      });
    }, 10 * 1000);
  });
}

devserver.start();

if (process.env.TRAVIS && browser !== 'firefox') {
  startSauceConnect(startTest);
} else {
  startSelenium(startTest);
}
