'use strict';

var request = require('request')
  , qs = require('querystring')
  , jsonreq = request.defaults({json:true})

function makeError(err, resp){
  var errObject = new Error(resp.statusCode + ' ' + err.reason)

  // for backward compatbility, we'll add a reason to the error object so that
  // err.reason will continue to work
  for (var key in err){
    if (err.hasOwnProperty(key)) errObject[key] = err[key]
  }
  err.statusCode = resp.statusCode
}

function Couch (options) {
  var self = this
  if (typeof options === 'string') options = {url:options}

  for (var i in options) {
    if (options.hasOwnProperty(i)) self[i] = options[i]
  }
  if (self.url[self.url.length - 1] !== '/') self.url += '/'
  self.designs = {}

}

Couch.prototype.get = function (id, cb) {
  request({url:this.url+encodeURIComponent(id), json:true}, function (err, resp, doc) {
    if (err) return cb(err)
    if (resp.statusCode !== 200) {
      return cb(makeError(doc, resp))
    }
    cb(null, doc)
  })
}

Couch.prototype.post = function (doc, cb) {
  if (typeof doc === 'string') doc = {_id:doc}
  if (!doc.created) doc.created = new Date()
  request.post({url:this.url, json:doc}, function (e, resp, info) {
    if (e) return cb(e)
    info.statusCode = resp.statusCode
    if ((doc._deleted && resp.statusCode !== 200) ||
      (!doc._deleted && resp.statusCode !== 201)) return cb(makeError(info, resp))
    if (!info.rev) return cb(makeError(info, resp))
    if (cb) cb(null, info)
  })
}

Couch.prototype.delete = function (id, cb) {
  var self = this
    , rev
    ;
  if (typeof id === 'object') {
    rev = id._rev
    id = id._id
  }

  function write (r) {
    request.del(self.url+encodeURIComponent(id)+'?rev='+r, function (e, resp, info) {
      if (e) return cb(e)
      if (resp.statusCode === 409 && !rev) {
        return self.delete(id, cb)
      }
      if (resp.statusCode !== 200) {
        return cb(makeError(info, resp))
      }
      cb(null, info)
    })
  }

  if (rev) {
    write(rev)
  } else {
    this.get(id, function (e, doc) {
      if (e) return cb(e)
      write(doc._rev)
    })
  }
}

Couch.prototype.force = function (doc, cb) {
  if (!doc._id || !doc._rev) throw new Error('Document must have rev and id.')
  request.post({url:this.url+'_bulk_docs', json:{new_edits:false, docs:[doc]}}, function (e, resp, info) {
    if (e) return cb(e)
    info.statusCode = resp.statusCode
    if (resp.statusCode !== 201) return cb(makeError(info, resp))
    if (!info.rev) return cb(makeError(info, resp))
    if (cb) cb(null, info)
  })
}

Couch.prototype.design = function (name) {
  if (!this.designs[name]) this.designs[name] = new Design(this, name)
  return this.designs[name]
}

Couch.prototype.update = function (id, mutate, cb, retries) {
  var self = this
    , retryMax = retries || 3
    , retryCount = 0

  if (!cb) cb = function () {}
  self.get(id, function (e, doc) {
    if (e && e.error === 'not_found') {
      e = null
      doc = {_id:id}
    }
    if (e) return cb(e)
    mutate(doc)
    request.post({url:self.url, json:doc}, function (e, resp, info) {
      if (e) return cb(e)
      if (resp.statusCode.toString().charAt(0) !== '2'){
        if (retryCount++ <= retryMax) return self.update(id, mutate, cb)
        else return cb(makeError({error: resp.statusCode, reason: resp.statusCode + 'is not 2**'}), resp)
      }
      cb(null, info)
    })
  })
}

Couch.prototype.atomic = function (id, name, value, cb) {
  var self = this
  if (!cb) cb = function () {}
  self.get(id, function (e, doc) {
    if (e && e.error === 'not_found') {
      e = null
      doc = {_id:id}
    }
    if (e) return cb(e)
    if (Array.isArray(name)) {
      var d_ = doc
        , n_ = Array.apply([], name)
        ;
      while (n_.length !== 1) {
        if (!d_[n_[0]]) d_[n_[0]] = {}
        d_ = d_[n_.shift()]
      }
      d_[n_[0]] = value
    } else {
      doc[name] = value
    }
    request.post({url:self.url, json:doc}, function (e, resp, info) {
      if (e) return cb(e)
      if (resp.statusCode !== 201) {
        self.atomic(id, name, value, cb)
      } else {
        cb(null, info)
      }
    })
  })
}
Couch.prototype.all = function (opts, cb) {
  if (!cb) {
    cb = opts
    opts = {}
  }
  opts.url = this.url + '_all_docs'
  ;(new View()).query(opts, cb)
}

function Design (db, name) {
  this.db = db
  this.name = name
  this.views = {}
}

Design.prototype.view = function (name) {
  if (!this.views[name]) this.views[name] = new View(this, name)
  return this.views[name]
}

function View (design, name) {
  this.design = design
  this.name = name
}

View.prototype.query = function (opts, cb) {
  if (opts.key) opts.key = JSON.stringify(opts.key)
  if (opts.startkey) opts.startkey = JSON.stringify(opts.startkey)
  if (opts.endkey) opts.endkey = JSON.stringify(opts.endkey)

  var url =
      opts.url ||
      [ this.design.db.url.slice(0, this.design.db.url.length - 1)
      , '_design', this.design.name, '_view', this.name
      ].join('/')
    , q = {}
    ;
  delete opts.url

  var r = function (callback) {
    if (opts.keys) {
      for (var i in opts) {
        if (i !== 'keys') q[i] = opts[i]
      }
      url += '?' + qs.stringify(q)
      request.post({url:url, json:opts}, callback)
    } else {
      url += '?' + qs.stringify(opts)
      request({url:url, json:true}, callback)
    }
  }

  r(function (e, resp, body) {
    if (e) return cb(e)
    if (resp.statusCode !== 200) {
      return cb(makeError(body, resp))
    }
    cb(null, body)
  })
}

View.prototype.latest = function (startkey, args, cb) {
  if (Array.isArray(startkey)) startkey.push({})
  else startkey = [startkey, {}]
  var endkey = []
  for (var i=0;i<startkey.length-1;i++) {
    endkey.push(startkey[i])
  }
  if (!cb) {
    cb = args
    args = {}
  }
  args.startkey = startkey
  args.limit = 1
  args.endkey = endkey
  args.descending = true
  this.query(args, cb)
}

module.exports = function (url) {
  return new Couch(url)
}

module.exports.Couch = Couch;

module.exports.create = function (url, name, cb) {
  if (url[url.length - 1] !== '/') url += '/'
  url += name
  jsonreq.put(url, function (e, resp, body) {
    if (e) return cb(e)
    if (resp.statusCode !== 201) {
      return cb(makeError(body, resp))
    }
    cb(null, body)
  })
}

module.exports.diff = function(a, b, c) {
  // Adapted from https://github.com/cdinger/jquery-objectdiff/blob/master/jquery.objectdiff.js
  c = {} || c;
  [a, b].forEach(function(obj, index) {
    for (var prop in obj) {
      if (obj.hasOwnProperty(prop)) {
        if (typeof obj[prop] === "object") {
          c[prop] = module.exports.objectDiff(a[prop], b[prop], c);
        }
        else {
          if (a[prop] != b[prop]) {
            c[prop] = [a[prop], b[prop]];
          }
        }
      }
    }
  });
  return c;
}

