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
  var forwardPathAsync = options.forwardPathAsync || defaultForwardPathAsync(forwardPath);
  var filter = options.filter || defaultFilter;
  var limit = options.limit || '1mb';
  var preserveReqSession = options.preserveReqSession;

  /* To avoid confusion between the nested req, res, next functions, they are wordily named */

  function maybeModifyPath(reqOpts) {
    reqOpts.path = forwardPath(reqOpts);
    return Promise.resolve(reqOpts);
  }

  var maybeDoNothing = function(userReq, userNext) {
      return new promise.Promise(function(resolve, reject) {
        return filter(userReq) ? resolve(userReq) : reject(userNext);
      });
  };

  var parseReqBody = function(userReq, proxyReqOpts) {
    return new promise.Promise(function(resolve, reject) {
      if (userReq.body) {
        proxyReqOpts.body = userReq.body;
        resolve(proxyReqOpts);
      } else {
        getRawBody(userReq, {
          length: userReq.headers['content-length'],
          limit: limit,
          encoding: bodyEncoding(options),
        }, function (err, body) {
          if(err) {
            reject(err);
          }
          proxyReqOpts.body = body;
          resolve(proxyReqOpts);
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
        //resolve(req);userReq
      //});
    //};

    //var createProxyReqOpts = function (req) {
      //return new promise.Promise(function (resolve) {
        //resolve(req);
      //});
    //};



    //Promise.all([
      //maybeDoNothing(userReq, userNext),
      //parseReqBody(userReq),
      //maybeModifyPath(userReq)
    //]).then(function (responses) {
      //proxyRequest.apply(null, responses);
    //}
      //proxyPath = responses[2];
      //proxyRequest(userReq, userRes, userNext, proxyPath);
      //debugger;
      //console.log();
    //});

    var createProxyReqOpts = function (userReq) {
      var parsedHost = parseHost(host, userReq);
      var proxyReqOpts = {
        hostname: parsedHost.host,
        port: options.port || parsedHost.port,
        headers: reqHeaders(userReq, options),
        method: userReq.method,
        path: userReq.path,
        url: userReq.url,
        params: userReq.params,
      };
      if (preserveReqSession) {
        proxyReqOpts.session = userReq.session;
      }
      return Promise.resolve(proxyReqOpts);
    };

    function maybeModifyReqBody(proxyReqOpts, userReq) {
      if (decorateRequest) {
        debugger;
        proxyReqOpts = decorateRequest(proxyReqOpts, userReq) || proxyReqOpts;
      }

      return Promise.resolve(proxyReqOpts);
    }

    function maybeModifyResponse(proxyResponse, userReq, userRes) {
      if (!intercept) {
        return promise.Promise.resolve(proxyResponse);
      }

      return new promise.Promise(function (resolve,reject) {
        // doing pushups to maintain the old interface
        intercept(proxyResponse.response, proxyResponse.rspData, userReq, userRes,
          function (err, rspd, sent){
            if (err) {
              reject(err);
            }

            debugger;
            rspd = asBuffer(rspd, options);

            if (!Buffer.isBuffer(rspd)) {
              userNext(new Error('intercept should return string or' +
                    'buffer as data'));
            }

            if (!userRes.headersSent) {
              userRes.set('content-length', rspd.length);
            } else if (rspd.length !== proxyResponse.rspData.length) {
              var error = '"Content-Length" is already sent,' +
                    'the length of response data can not be changed';
              userNext(new Error(error));
            }



            if (!sent) {
              resolve({
                response: proxyResponse.response,
                rspd: rspd,
                sent: sent
              });
            }
        });

      });
    }
    maybeDoNothing(userReq, userNext)
      .then(function(userReq){
        return createProxyReqOpts(userReq);
      })
      .then(function(proxyReqOpts) {
        return parseReqBody(userReq, proxyReqOpts);
      })
      .then(function(proxyReqOpts) {
        return maybeModifyPath(proxyReqOpts);
      })
      .then(function(proxyReqOpts) {
        return maybeModifyReqBody(proxyReqOpts, userReq);
      })
      .then(function(proxyReqOpts) {
        return cleanUpBodyContent(proxyReqOpts);
      })
      .then(function(proxyReqOpts) {
        return setRequestHeaders(proxyReqOpts);
      })
      .then(function (proxyReqOpts) {
        return proxyReq2(proxyReqOpts, userReq, userNext);
      })
      .then(function(proxyResponse) {
        return copyProxyResponseHeaders(proxyResponse, userRes);
      })
      .then(function (proxyResponse) {
        return maybeModifyResponse(proxyResponse, userReq, userRes);
      })
      .then(function(finalResponse) {
        userRes.send(finalResponse.rspd);
        userNext();
      })
      .catch(function (token) {
        userNext(token);
      });

  };

  function copyProxyResponseHeaders(proxyResponse, userRes) {
    // SIDE EFFECTS: THIS MODIFYS THE userRes !!!
    if (!userRes.headersSent) {
      var rsp = proxyResponse.response;
      userRes.status(rsp.statusCode);
      Object.keys(rsp.headers)
        .filter(function(item) { return item !== 'transfer-encoding'; })
        .forEach(function(item) {
          userRes.set(item, rsp.headers[item]);
        });
    }

    return Promise.resolve(proxyResponse);

  }


  function setRequestHeaders(proxyReqOpts) {
    proxyReqOpts.headers['content-length'] = getContentLength(proxyReqOpts.body);

    if (bodyEncoding(options)) {
      proxyReqOpts.headers[ 'Accept-Encoding' ] = bodyEncoding(options);
    }

    return Promise.resolve(proxyReqOpts);
  }

  function cleanUpBodyContent(proxyReqOpts) {
    proxyReqOpts.body = options.reqAsBuffer ?
      asBuffer(proxyReqOpts.body, options) :
      asBufferOrString(proxyReqOpts.body);

     return Promise.resolve(proxyReqOpts);
  }

  function proxyReq2(proxyReqOpts, userReq) {
    return new promise.Promise(function (resolve) {
      var parsedHost = parseHost(host, userReq); // terrible, but needed atm
      var proxyReq = parsedHost.module.request(proxyReqOpts, function(rsp) {
        var chunks = [];

        rsp.on('data', function(chunk) {
          chunks.push(chunk);
        });

        rsp.on('end', function() {
          var rspData = Buffer.concat(chunks, chunkLength(chunks));
          resolve({
            response: this,
            rspData: rspData
          });
        });
      });
      proxyReq.end();
    });
  }

  function proxyRequest(proxyReqOpts, userReq, userNext) {
    runProxy(proxyReqOpts.body);

    function runProxy(bodyContent) {

      var parsedHost = parseHost(host, userReq); // terrible, but needed atm

      //if (err && !bodyContent) {
        //return userNext(err);
      //}

      debugger;
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
