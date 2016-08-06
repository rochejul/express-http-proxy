var assert = require('assert');
var url = require('url');
var http = require('http');
var https = require('https');
var getRawBody = require('raw-body');
var promise = require('es6-promise');

module.exports = function proxy(host, options) {
  'use strict';

  assert(host, 'Host should not be empty');

  options = options || {};

  var parsedHost;

  /**
   * Function :: intercept(targetResponse, data, res, req, function(err, json, sent));
   */
  var intercept = options.intercept;
  var decorateRequest = options.decorateRequest;
  var forwardPath = options.forwardPath || defaultForwardPath;
  // Transition to new option name && Deprecate this option name
  var maybeModifyPath = options.forwardPathAsync || defaultForwardPathAsync(forwardPath);
  var filter = options.filter || defaultFilter;
  var limit = options.limit || '1mb';
  var preserveReqSession = options.preserveReqSession;

  /* To avoid confusion between the nested req, res, next functions, they are wordily named */

  var maybeDoNothing = function(userReq, userNext) {
      return new promise.Promise(function(resolve, reject) {
        return filter(userReq) ? resolve(userReq) : reject(userNext);
      });
  };

  var parseReqBody = function(req) {
    return new promise.Promise(function(resolve, reject) {
      if (req.body) {
        resolve(req);
      } else {
        getRawBody(req, {
          length: req.headers['content-length'],
          limit: limit,
          encoding: bodyEncoding(options),
        }, function (err, body) {
          if(err) {
            reject(err);
          }
          req.body = body;
          resolve(req);
        });
      }
    });
  };

  return function proxy(userReq, userRes, userNext) {

    // My Dream!
    //maybeDoNothing(userReq)
      //.then(maybeModifyPath)
      //.then(getRequestBody)
      //.then(maybeModifyRequest)
      //.then(maybeModifyRequestBody)
      //.then(doProxyRequest)
      //.then(maybeModifyResponse)
      //.then(userResponse);
      ////.catch()

    //var maybeModifyReqBody = function (req) {
      //return new promise.Promise(function (resolve, reject) {
        //resolve(req);
      //});
    //};

    //var createProxyReqOpts = function (req) {
      //return new promise.Promise(function (resolve) {
        //resolve(req);
      //});
    //};

    maybeDoNothing(userReq, userNext)
      .then(function(userReq) {
        parseReqBody(userReq)
          .then(function(userReq) {
            maybeModifyPath(userReq)
            .then(function(proxyPath) {
              proxyRequest(userReq, userRes, userNext, proxyPath);
            });
          });
      })
      .catch(function (widget) {
        userNext(widget);
      });

  };

  function proxyRequest(userReq, userRes, userNext, proxyPath) {

    parsedHost = parsedHost || parseHost(host, userReq);

    runProxy(userReq.body);

    function runProxy(bodyContent) {
      var proxyReqOpts = {
        hostname: parsedHost.host,
        port: options.port || parsedHost.port,
        headers: reqHeaders(userReq, options),
        method: userReq.method,
        path: proxyPath,
        bodyContent: bodyContent,
        params: userReq.params,
      };

      if (preserveReqSession) {
        proxyReqOpts.session = userReq.session;
      }

      if (decorateRequest) {
        proxyReqOpts = decorateRequest(proxyReqOpts, userReq) || proxyReqOpts;
      }

      bodyContent = proxyReqOpts.bodyContent;
      delete proxyReqOpts.bodyContent;
      delete proxyReqOpts.params;

      //if (err && !bodyContent) {
        //return userNext(err);
      //}

      bodyContent = options.reqAsBuffer ?
        asBuffer(bodyContent, options) :
        asBufferOrString(bodyContent);

      proxyReqOpts.headers['content-length'] = getContentLength(bodyContent);

      if (bodyEncoding(options)) {
        proxyReqOpts.headers[ 'Accept-Encoding' ] = bodyEncoding(options);
      }

      var proxyReq = parsedHost.module.request(proxyReqOpts, function(rsp) {
        var chunks = [];

        rsp.on('data', function(chunk) {
          chunks.push(chunk);
        });

        rsp.on('end', function() {

          var rspData = Buffer.concat(chunks, chunkLength(chunks));

          if (intercept) {
            intercept(rsp, rspData, userReq, userRes, function(err, rspd, sent) {
              if (err) {
                return userNext(err);
              }

              rspd = asBuffer(rspd, options);

              if (!Buffer.isBuffer(rspd)) {
                userNext(new Error('intercept should return string or' +
                      'buffer as data'));
              }

              if (!userRes.headersSent) {
                userRes.set('content-length', rspd.length);
              } else if (rspd.length !== rspData.length) {
                var error = '"Content-Length" is already sent,' +
                      'the length of response data can not be changed';
                userNext(new Error(error));
              }

              if (!sent) {
                userRes.send(rspd);
              }
            });
          } else {
            // see issue https://github.com/villadora/express-http-proxy/issues/104
            // Not sure how to automate tests on this line, so be careful when changing.
            if (!userRes.headersSent) {
              userRes.send(rspData);
            }
          }
        });

        rsp.on('error', function(e) {
          userNext(e);
        });

        if (!userRes.headersSent) {
          userRes.status(rsp.statusCode);
          Object.keys(rsp.headers)
            .filter(function(item) { return item !== 'transfer-encoding'; })
            .forEach(function(item) {
              userRes.set(item, rsp.headers[item]);
            });
        }
      });

      if (bodyContent.length) {
        proxyReq.write(bodyContent);
      }

      proxyReq.end();

      proxyReq.on('socket', function(socket) {
        if (options.timeout) {
          socket.setTimeout(options.timeout, function() {
            proxyReq.abort();
          });
        }
      });

      proxyReq.on('error', function(err) {
        if (err.code === 'ECONNRESET') {
          userRes.setHeader('X-Timout-Reason',
            'express-http-proxy timed out your request after ' +
            options.timeout + 'ms.');
          userRes.writeHead(504, {'Content-Type': 'text/plain'});
          userRes.end();
          userNext();
        } else {
          userNext(err);
        }
      });


      userReq.on('aborted', function() {
        proxyReq.abort();
      });
    }
  }
};



function extend(obj, source, skips) {
  'use strict';

  if (!source) {
    return obj;
  }

  for (var prop in source) {
    if (!skips || skips.indexOf(prop) === -1) {
      obj[prop] = source[prop];
    }
  }

  return obj;
}

function parseHost(host, req) {
  'use strict';

  host = (typeof host === 'function') ? host(req) : host.toString();

  if (!host) {
    return new Error('Empty host parameter');
  }

  if (!/http(s)?:\/\//.test(host)) {
    host = 'http://' + host;
  }

  var parsed = url.parse(host);

  if (!parsed.hostname) {
    return new Error('Unable to parse hostname, possibly missing protocol://?');
  }

  var ishttps = parsed.protocol === 'https:';

  return {
    host: parsed.hostname,
    port: parsed.port || (ishttps ? 443 : 80),
    module: ishttps ? https : http,
  };
}

function reqHeaders(req, options) {
  'use strict';

  var headers = options.headers || {};

  var skipHdrs = [ 'connection', 'content-length' ];
  if (!options.preserveHostHdr) {
    skipHdrs.push('host');
  }
  var hds = extend(headers, req.headers, skipHdrs);
  hds.connection = 'close';

  return hds;
}

function defaultFilter() {
  // No-op version of filter.  Allows everything!
  'use strict';
  return true;
}

function defaultForwardPath(req) {
  'use strict';
  return url.parse(req.url).path;
}

function bodyEncoding(options) {
  'use strict';

  /* For reqBodyEncoding, these is a meaningful difference between null and
   * undefined.  null should be passed forward as the value of reqBodyEncoding,
   * and undefined should result in utf-8.
   */

  return options.reqBodyEncoding !== undefined ? options.reqBodyEncoding: 'utf-8';
}


function chunkLength(chunks) {
  'use strict';

  return chunks.reduce(function(len, buf) {
    return len + buf.length;
  }, 0);
}

function defaultForwardPathAsync(forwardPath) {
  'use strict';
  return function(req) {
    return new promise.Promise(function(resolve) {
      resolve(forwardPath(req));
    });
  };
}

function asBuffer(body, options) {
  'use strict';
  var ret;
  if (Buffer.isBuffer(body)) {
    ret = body;
  } else if (typeof body === 'object') {
    ret = new Buffer(JSON.stringify(body), bodyEncoding(options));
  } else if (typeof body === 'string') {
    ret = new Buffer(body, bodyEncoding(options));
  }
  return ret;
}

function asBufferOrString(body) {
  'use strict';
  var ret;
  if (Buffer.isBuffer(body)) {
    ret = body;
  } else if (typeof body === 'object') {
    ret = JSON.stringify(body);
  } else if (typeof body === 'string') {
    ret = body;
  }
  return ret;
}

function getContentLength(body) {
  'use strict';
  var result;
  if (Buffer.isBuffer(body)) { // Buffer
    result = body.length;
  } else if (typeof body === 'string') {
    result = Buffer.byteLength(body);
  }
  return result;
}
