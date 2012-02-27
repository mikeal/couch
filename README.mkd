# couch -- Stupid simple Couch wrapper based on Request.

## Install

<pre>
  npm install couch
</pre>

Or from source:

<pre>
  git clone git://github.com/mikeal/couch.git 
  cd couch
  npm link
</pre>

## Usage

```javascript
var couch = require('couch')
  , c = couch('http://me.iriscouch.com/db')
  ;

c.post({'msg':'new document'}, function (e, info) {
  if (e) throw e
  c.post({'msg':'new document', _id:info.id, _rev:info.rev}, function (e, info) {
    if (e) throw e
    c.get(info.id, function (e, doc) {
      if (e) throw e
      console.log(doc) // {'msg':'new document', _id:<id>, _rev:<rev>}
    })
  })
})
```

## Couch

* new Couch(options) - return value from require('couch')(url)
* Couch.get(id, cb) - get a document of the specified id
* Couch.post(doc, cb) - write a document. MUST have _id and _rev if already exists
* Couch.update(id, mutate, cb) - updated an existing document atomically (regardless of revision)

```javascript
c.update('myid', function (doc) {doc.status = 'complete'}, function (e, info) {
 if (e) throw e
 console.log(info) // {seq:<seq>, id:<id>, rev:<rev>} 
}) 
```
## Views

* Couch.all(opts, cb) - Hits the /db/\_all_docs API which accepts similar arguments and has a simpilar return value to views but is an index of all documents in CouchDB.

```javascript
c.all({keys:['onlykey1', 'onlykey2']}, function (e, results) {
  if (e) throw e
  console.log(results.rows) // [{id:onlykey1, rev:<rev>}, {id:onlykey2, rev:<rev>}]
})
```

* Couch.design(name).view(name).query(opts)

```javascript
c.design('app').view('byProperty').query({key:'type', include_docs:true}, function (e, results) {
  console.log(results.rows)
})
```