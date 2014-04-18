---
layout: post

title: Secondary indexes have landed in PouchDB

author: Nolan Lawson

---

With the release of PouchDB 2.2.0, we're happy to introduce a feature that's been cooking on the slow simmer for some time: secondary indexes, a.k.a. persisted map/reduce.

This is a big new feature, one that vastly improves the flexibility of the PouchDB API, as well as bringing us one (giant) step closer to full compliance with CouchDB.

What? You put map/reduce in my JavaScript?
------------

First, let's define what persisted map/reduce is.  Relational databases would traditionally allow you to query whatever fields you wanted (`SELECT * FROM pokemon WHERE name = 'Pikachu'`), and additionally you could add an index (`ALTER TABLE pokemon ADD INDEX myIndex ON (name)`) if you didn't want your performance to be terrible.

Document stores like CouchDB and MongoDB are a little different, though. By default, documents are assumed to be schemaless blobs with one primary key (called `_id` in both Mongo and Couch), and any other keys need to be specified separately.  Really, the concept is the same as in relational databases; it's just the vocabulary that's different.
 
In CouchDB, secondary indexes are called map/reduce functions.  This is because, as in many NoSQL databases, CouchDB is designed to scale well across multiple nodes and perform query operations in parallel efficiently.  The simplest map function looks like this:

```js
function (pokemon) {
  emit(pokemon.name);
}
```  

&hellip; and is functionally equivalent to the SQL index given above.  As for `reduce` functions, they're a little gnarlier, so we'll cover them later.

Although the map/reduce algorithm itself, and its intended purpose of enablling efficient parallel processing, doesn't really make sense in a single-threaded JavaScript environment, PouchDB borrows the API wholesale from CouchDB. That way, you can write the same code against your local database as against your remote database &ndash; e.g. when you're using CouchDB as a fallback on older browsers.

So hopefully, even if you're not well-versed in the concept of map/reduce, you are at the very least intrigued by it, and you may even be pleased by the prospect of a little JavaScript database teaching you the core concepts of map/reduce in a fun and accessible way.  If the previous statement does not describe you, skip down to the section called "When not to use map/reduce".

What map/reduce is capable of
------------

The map/reduce API for CouchDB (and now PouchDB) is a very powerful piece of machinery. It allows you to reach into your documents with a full JavaScript environment, and allows you to perform queries on your data that would otherwise be very tedious.  For instance, say you have a database like this one:

```js
[{
      "_id"  : "bowie",
      "name" : "David Bowie",
      "age"  : 67
    }, {
      "_id"  : "dylan",
      "name" : "Bob Dylan",
            "age"  : 72
    }, {
      "_id"  : "younger_dylan",
      "name" : "Jakob Dylan",
            "age"  : 44
    }, {
      "_id"  : "hank_the_third",
      "name" : "Hank Williams",
            "age"  : 41
    }, {
      "_id"  : "hank",
      "name" : "Hank Williams",
            "age"  : 91
    }]
```

If you call `db.allDocs()`, you'll just get every document sorted by its `_id`:

```js
    {
      "id": "bowie",
      "key": "bowie",
      "value": {
        "rev": "1-e018c5bbceba92e52bf4e46b503828f5"
      }
    }, {
      "id": "dylan",
      "key": "dylan",
      "value": {
        "rev": "1-1ce006d980cc690d89787bbf2241dc01"
      }
    }, {
      "id": "hank",
      "key": "hank",
      "value": {
        "rev": "1-38801b1e21b177f5479625a6a3899659"
      }
    }, {
      "id": "hank_the_third",
      "key": "hank_the_third",
      "value": {
        "rev": "1-cfda51b9e3966d9c36d2c8fcc99cae3b"
      }
    }, {
      "id": "younger_dylan",
      "key": "younger_dylan",
      "value": {
        "rev": "1-d884b08a9b759274bf49c7d994ca8542"
      }
    }
```

However, with the `query()` API, you can sort these rockers (somewhat unflatteringly) by their age:

```js
function (rocker) {
  emit(rocker.age);
}

```

```js
[ { id: 'hank_the_third', key: 41, value: null },
     { id: 'younger_dylan', key: 44, value: null },
     { id: 'bowie', key: 67, value: null },
     { id: 'dylan', key: 72, value: null },
     { id: 'hank', key: 91, value: null } ] 
```

Or by their last name:

```js
function (rocker) {
  emit(rocker.name.split(' ')[1]);
}

```

```js
   [ { id: 'bowie', key: 'Bowie', value: null },
     { id: 'dylan', key: 'Dylan', value: null },
     { id: 'younger_dylan', key: 'Dylan', value: null },
     { id: 'hank', key: 'Williams', value: null },
     { id: 'hank_the_third', key: 'Williams', value: null } ] }
```

A `reduce` function runs aggregate operations against whatever's emitted in the `map` function.  So for instance, we can also use that to count up the number of rockers by last name:

```js
{
  map: function (rocker) {
    emit(rocker.name.split(' ')[0]);
  },
  reduce: '_count'
}
```

Returns:

```js
foobar
```

There are also custom reduce functions, complex keys, `group_level`, closures, and other neat tricks that are beyond the scope of this article, but suffice it to say, the `query()` API gives you a pretty sophisticated set of tools for working with your data.

### Before PouchDB 2.2.0

PouchDB actually already had map/reduce since way before version 2.2.0, and all the examples above would have worked just fine. The old `query()` API suffered from a big flaw, though: all queries were performed in-memory, reading in the entire database in order to perform a single operation.

This is fine for small data sets, but it could be murder for large databases. On mobile devices especially, memory is a precious commodity, so you want to be as frugal as possible with what the OS gives you.

Map/reduce, reuse, recycle
----------

The new `query()` API is much more memory-efficient, and it won't read in the entire database unless you tell it to.  (Read up on pagination with `startkey` and `skip` to understand how to avoid this.)  It has two modes:

* temporary views (like the old API)
* persistent views (new API)

Both of these concepts exist in CouchDB, and they're faithfully emulated in PouchDB.

First off, some vocabulary: CouchDB technically calls indexes "views," and these views are stored in a special document called a "design document." Basically, a design document describes a view, and a view describes a map/reduce query, which tells the database that you plan to use that query later, so it better start indexing it now.

Temporary views are just that &ndash; temporary. They create a view, write an index to the database, query the view, and then poof, they're deleted.  That's why in older version of PouchDB we could get away by doing it all in-memory.

Crucially, temporary views need to do a full table scan every time you execute them, along with all the reading and writing to disk that that entails, just to throw it away at the end.  That may be fine for quick testing during development, but in production environments it can be a big drag on performance.

Persistent views, however, are a much better solution if you want your queries to be fast and efficient.  Persistent views require you to first save a design document containing your view, so that the emitted fields are already indexed by the time you need to look them up.  Subsequent lookups don't need to do any additional writes on the database, unless documents have been added or modified, in which case only the diff needs to be applied.

For those who get nostalgic
----

Of course, some of our loyal Pouchinistas may have been perfectly satisfied with the old way of doing things. The fact that the `query()` function read the entire database into memory might actually have served them just fine, thank you.

There are certainly some legitimate use cases for this. If you don't store a lot of data, or if all your users are on desktop computers, or if you require closures (not supported by persistent views), then you may have been perfectly happy before. In fact, an upgrade to 2.2.0 might actually make your app perform more slowly, since it now has to write to disk.

Luckily we have a great solution for you: instead of using the `query()` API, you can use the much more straightforward `allDocs()` API.  This will read all documents into memory, just like before, but best of all, you can apply whatever functions you want to the data, without having to bother with learning a new API or even what the heck "map/reduce" is. Hopefully many of you were already using this strategy.

When *not* to use map/reduce
----

Now that I've sold you on how awesome map/reduce is, let's talk about the situations where you might want to avoid it.

First off, you may have noticed that the CouchDB map/reduce API is pretty daunting.  As a newbie Couch user who very recently struggled with the API, I can empathize: the vocabulary is new, the concepts are probably new, and there's really no easy way to learn it, except to spin up a database for testing and clack at your keyboard for awhile.

Second off, views take quite some time to build up, both in CouchDB and PouchDB. Each document has to be read into memory in order for the `map` function to be applied to it, and this can take awhile for larger databases. So if you're hoping for a near-instantaneous indexes, you're going to be disappointed.

Luckily, it turns out that the primary indexes provided by both CouchDB and PouchDB are usually enough to get what you want done, for the average use case.  If you're just using the random UUIDs that are generated when you don't provide your own `_id`, then you're probably missing out on a great opportunity to have a meaningful index on your data. (Plus, you're incurring the overhead of an index you're never going to use!)

For instace, say your documents are emails that you want to sort by recency: boom, set the `_id` to `new Date().toJSON()`.  Or say they're web pages that you want to look up by URL: use the URL itself as the `_id`! Neither CouchDB nor PouchDB have a limit on how long your `_id`s can be, so you can get as fancy as you want with this.

For a more elaborate example, let's imagine your database looks like this:

```js
[ { _id: 'artist_bowie',
    type: 'artist',
    name: 'David Bowie',
    age: 67 },
  { _id: 'artist_dylan',
    type: 'artist',
    name: 'Bob Dylan',
    age: 72 },
  { _id: 'album_bowie_ziggy_stardust',
    artist: 'artist_bowie',
    title: 'The Rise and Fall of Ziggy Stardust and the Spiders from Mars',
    type: 'album',
    year: 1972 },
  { _id: 'album_bowie_hunky_dory',
    artist: 'artist_bowie',
    title: 'Hunky Dory',
    type: 'album',
    year: 1971 },
  { _id: 'album_dylan_highway_61',
    artist: 'artist_dylan',
    title: 'Highway 61 Revisited',
    type: 'album',
    year: 1965 } ]
```

Notice what we've done here: artist-type documents are prefixed with `artist_`, and album-type documents are prefixed with `album`.  This naming scheme is clever enough that we can already do lots of complex queries using `allDocs()`, even though we're storing two different types of documents.

Want to find all artists?  It's just `allDocs({startkey: 'artist_', endkey: 'artist__'})`.  

Want to find all albums?  Try `allDocs({startkey: 'albums_', endkey: 'albums__'})`.

Want to find all albums by David Bowie?  Wham bam, thank you ma'am: `allDocs({startkey: 'album_bowie_', endkey: 'album_bowie__'})`.

In this example, you're getting all those "indexes" for free, each time a document is added to the database.  It doesn't take up any additional space on disk compared to UUIDs, and you neither have to wait for a view to get built up, nor do you have to understand the map/reduce API at all.

Of course, this system starts to get shaky when you need to search by a variety of criteria: e.g. albums sortedy by year, artists sorted by age, etc. But for a lot of simple apps, you should be able to get by without using the `query()` API at all.

For the nerds: implementation details
-------

If you want to know how map/reduce works in PouchDB, it's actually exceedingly easy: just open up your dev console, and see where we've created a bonus database to store the index.

One of the neat things about how we implemented map/reduce is that we actually did it entirely with PouchDB itself.  Yes folks, that's right: your map/reduce view is just a regular old PouchDB database, and map/reduce itself is just a plugin with no special privileges, creating databases in exactly the same way a regular user would.  The map/reduce code is exactly the same for all three backends: LevelDB, IndexedDB, and WebSQL.

And just to be clear: it's not like we set out to make PouchDB some kind of map/reduce engine.  In fact, as we were debating how to implement this feature, we originally ran with the assumption that we'd need to build additional functionality on top of PouchDB, and it was only after a few months of work that we realized the whole thing could be done in PouchDB proper.  In the end, the only additional functionality that had to be added was a hook to tell PouchDB to destroy the map/reduce database when its parent database was destroyed.  That's it.

This fact also has a nice parallel in CouchDB: it turns out that they, too, reused most of the core view code itself to implement the database.  As they say in the docs, `_all_Docs` is just a special kind of view.

As for the index itself, what it basically boils down to is clever serialization of arbitrary JSON values into CouchDB-style collation ordering (e.g. booleans before ints, ints before strings, strings before arrays, arrays before objects, and so on recursively).

Then, we take this value and concatenate it with whatever else needs to be indexed (usually just the doc `_id`), meaning the entire lookup key is a single string.  We decided on this implementation because:

1. LevelDB does not support complex indexes.
2. IndexedDB does support complex indexes, but not in IE.
3. WebSQL supports multi-field indexes, but it's also a dead spec, so we're not going to prioritize it above the others.

Since we're storing many types of documents in a single database that must be synced with one another, and since by design CouchDB/PouchDB do not have multi-document transaction semantics, we implemented a task queue on top of the database to serialize writes.  Interestingly, this is the same approach Google took when they implemented IndexedDB on top of LevelDB, and it's similar to what we're currently doing for our own LevelDB adapter (although since we don't need full transactions, we avoid a full task queue for most operations, and just use optimistic locks instead).

Aside from that, the only other neat trick is a liberal use of `_local` documents, which are a special class of documents that aren't counted in the `total_rows` count, don't show up in `allDocs`, but may be accessed using the normal `put()` and `get()` methods.  This is all it takes to fully reimplement CouchDB map/reduce in a tiny JavaScript database!

Anyone interested in more implementation details can read the months-long discussions in mapreduce/12, 1549, and 1658.  The code itself is also pretty succinct.