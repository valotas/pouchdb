rm -fr tests_cordova/www/vendor
rm -fr tests_cordova/www/node_modules
rm -fr tests_cordova/www/tests

cp -r vendor tests_cordova/www/vendor
mkdir -p tests_cordova/www/node_modules
cp -r node_modules/mocha node_modules/chai tests_cordova/www/node_modules
cp -r tests tests_cordova/www/tests

# god help me, I am terrible at bash
all_test_files=$(egrep '(test|browser).*.js' tests/test.html | sed "s/<script src='//g" | sed "s/'><\/script>//g" | awk '{print $1}' | tr '\n' ' ' | sed "s/ /','/g" | sed "s/,'$//g" | sed "s/^/'/g")
echo "var allTestFiles = [$all_test_files];" > tests_cordova/www/tests/all-test-files.js
