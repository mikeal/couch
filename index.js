var request = require('request')
  , qs = require('querystring')
  , follow = require('follow')
  , jsonreq = request.defaults({json:true})
  ;
  
var chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  
function shortid () {  
  return chars[Math.floor(Math.random() * chars.length)] + 
         chars[Math.floor(Math.random() * chars.length)] +
         chars[Math.floor(Math.random() * chars.length)] + 
         chars[Math.floor(Math.random() * chars.length)]
}  

function Couch (options) {
  var self = this
  if (typeof options === 'string') options = {url:options}
  for (i in options) {
    self[i] = options[i]
  }
  if (self.url[self.url.length - 1] !== '/') self.url += '/'
  self.designs = {}
  
  if (self.follow) {
    request({url:self.url, json:true}, function (e, r, info) {
      self._seq = info.update_seq
      self.follow = follow(self.url)
      self.follow.since = self.seq
      self.follow.once('confirm', function () {
        self.following = true
        while (self.afterFollow.length) self.afterFollow.shift()(self)
      })
      self.follow.on('change', function (info) {
        self._seq = info.seq
      })
    })
  }
}
Couch.prototype.afterFollow = function (cb) {
  if (!this.following) this.followCallbacks.push(cb)
  else cb(this)
}
Couch.prototype.seq = function (cb) {
  this.afterFollow(function (c) { cb(c._seq) })
}

Couch.prototype.get = function (id, cb) {
  request({url:this.url+id, json:true}, function (err, resp, doc) {
    if (err) return cb(err)
    if (resp.statusCode !== 200) {
      var e = doc ? doc : new Error('CouchDB error.') // make this smarter later
      e.statusCode = resp.statusCode
      return cb(e)
    }
    cb(null, doc)
  })
}

Couch.prototype.post = function (doc, cb) {
  if (typeof doc === 'string') doc = {_id:string}
  if (!doc.created) doc.created = new Date()
  request.post({url:this.url, json:doc}, function (e, resp, info) {
    if (e) return cb(e)
    info.statusCode = resp.statusCode
    if (resp.statusCode !== 201) return cb(info)
    if (!info.rev) return cb(info)
    if (cb) cb(null, info)
  })
}

Couch.prototype.design = function (name) {
  if (!this.designs[name]) this.designs[name] = new Design(this, name)
  return this.designs[name]
}

Couch.prototype.update = function (id, mutate, cb) {
  var self = this
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
      if (resp.statusCode !== 201) return self.update(id, mutate, cb)
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
  
  r = function (callback) {
    if (opts.keys) {
      for (i in opts) {
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
      var e = body ? body : new Error('CouchDB error.') // make this smarter later
      e.statusCode = resp.statusCode
      return cb(e)
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
module.exports.create = function (url, name, cb) {
  if (url[url.length - 1] !== '/') url += '/'
  url += name
  jsonreq.put(url, function (e, resp, body) {
    if (e) return cb(e)
    if (resp.statusCode !== 201) {
      var e = body ? body : new Error('CouchDB error.') // make this smarter later
      e.statusCode = resp.statusCode
      return cb(e)
    }
    cb(null, body)
  })
}

module.exports.diff = function(a, b, c) {
  // Adapted from https://github.com/cdinger/jquery-objectdiff/blob/master/jquery.objectdiff.js
  c = {} || c;
  [a, b].forEach(function(obj, index) {
    for (prop in obj) {
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

