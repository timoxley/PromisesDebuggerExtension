console.log('PromisesDebugger inside');

(function(global) {
  "use strict";

  if (!global.Promise || global.PromisesDebugger) return;

  var getDesc = Object.getOwnPropertyDescriptor,
    hasOwn = Object.prototype.hasOwnProperty,
    recurciveGetDesc = function(object, prop) {
      do {
        var result = getDesc(object, prop);
      } while (!result && (object = Object.getPrototypeOf(object)));

      return result;
    },
    isPlainObject = function(obj) {
      var proto = Object.getPrototypeOf(obj);

      return proto === Object.prototype || proto == null;
    };

  var PromisesDebugger = {
    debugging: [],
    topLevel: [],
    diffs: [],
    promiseToRecord: new WeakMap(),
    promiseByProxy: new WeakMap(),
    nextId: 0,

    get: function(promise) {
      return PromisesDebugger.promiseToRecord.get(promise);
    },
    register: function(promise, params) {
      var registeredData = {
        promise: promise,
        setValue: function(val) {
          var value = val.value,
            sendData = {
              id: registeredData.id,
              state: val.type
            };

          if (value instanceof originalPromise) {
            var record = PromisesDebugger.promiseToRecord.get(value);

            sendData.value = {
              type: 'promise',
              id: record.id
            };
          } else if (
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
          ) {
            // truncate long strings
            if (typeof value === 'string' && value.length > 100) {
              value = value.slice(0, 100);
            }

            sendData.value = {
              type: 'primitive',
              value: value,
              primitive: typeof value
            };
          } else if (value instanceof Error) {
            sendData.value = {
              type: 'error',
              error: {
                stack: value.stack,
                message: value.message,
                code: value.code
              }
            };
          } else if (Array.isArray(value)) {
            sendData.value = {
              type: 'array'
            };
          } else if (value && typeof value === 'object') {
            if (isPlainObject(value)) {
              try {
                value = JSON.stringify(value, function replacer(key, val) {
                  if (typeof val === 'string' && val.length > 30) {
                    return val.slice(0, 30) + ' ...';
                  }

                  return val;
                }, '  ');
              } catch (e) {

              }
            }

            if (typeof value === 'string') {
              sendData.value = {
                type: 'json',
                json: value
              };
            } else {
              sendData.value = {
                type: 'object',
                object: value + ''
              };
            }
          } else if (typeof value === 'function') {
            sendData.value = {
              type: 'function',
              function: value + ''
            };
          } else {
            // console.log('value unknown:', value);
            sendData.value = {
              type: 'unknown',
              typeOf: typeof value
            };
          }

          this.value = value;
          this.state = val.type;

          PromisesDebugger.requestUpdate({
            event: 'value',
            data: sendData
          });
        },
        id: this.nextId++,
        chaining: [],
        stack: params && params.stack,
        topLevel: params ? params.topLevel !== false : true,
      },
      topLevel = registeredData.topLevel,
      parentPromise;

      this.debugging.push(registeredData);

      if (topLevel) {
        this.topLevel.push(registeredData);
      } else {
        params.parent.chaining.push(registeredData);
        parentPromise = params.parent.id;
      }

      this.requestUpdate({
        event: 'create',
        data: {
          id: registeredData.id,
          topLevel: topLevel,
          stack: registeredData.stack,
          parentPromise: parentPromise
        }
      });

      if (params && hasOwn.call(params, 'value')) {
        registeredData.setValue(params.value);
      }

      // wrapMethods(promise, registeredData);
      this.promiseToRecord.set(promise, registeredData);

      promise.__recordData__ = registeredData;

      return registeredData;
    },
    dumpTopLevel: function() {
      this.dumpArray(this.topLevel, 'TopLevel Promises');
    },
    dumpArray: function(array, title) {
      console.groupCollapsed(title);

      array.concat().reverse().forEach(function(record, i) {
        var data;

        console.groupCollapsed('Promise ' + i);

        if (!hasOwn.call(record, 'value')) {
          data = {
            PromiseValue: '[[No Value]]',
            PromiseStatus: 'Pending'
          };
        }

        if (record.value.type === 'error') {
          data = {
            PromiseValue: record.value.value,
            PromiseStatus: 'Error'
          };
        } else {
          data = {
            PromiseValue: typeof record.value.value,
            PromiseStatus: 'OK'
          };
        }

        console.log('PromiseValue:', data.PromiseValue);
        console.log('PromiseStatus:', data.PromiseStatus);
        if (record.chaining.length) {
          PromisesDebugger.dumpArray(record.chaining, 'Chaining Promises');
        }

        console.groupEnd();
      });

      console.groupEnd();
    },
    requestUpdate: function(diffData) {
      setTimeout(function() {

        // console.log('requestUpdate');

        window.postMessage({
          PromisesDebugger: true,
          message: diffData
        }, '*');
      }, 0);
    }
  };

  var promiseDesc = recurciveGetDesc(global, 'Promise'),
    originalPromise = global.Promise,
    originalPromiseResolve = recurciveGetDesc(originalPromise, 'resolve'),
    originalPromiseReject = recurciveGetDesc(originalPromise, 'reject'),
    originalPromiseAll = recurciveGetDesc(originalPromise, 'all'),
    originalPromiseRace = recurciveGetDesc(originalPromise, 'race');

  var wrapMethods = function(promise, registeredData) {
    var originalThen = recurciveGetDesc(promise, 'then'),
      originalCatch = recurciveGetDesc(promise, 'catch')

    registeredData.originalThen = originalThen;
    registeredData.originalCatch = originalCatch;

    promise.then = function(onResolve, onReject) {
      // 2 ways to handle 'then'
      // wrap call to try..catch
      // or add chaining then()

      var resolve = function(val) {
        chaingRegistered.setValue({
          type: 'value',
          value: val
        });

        return val;
      },
      reject = function(val) {
        chaingRegistered.setValue({
          type: 'error',
          value: val
        });

        return val;
      };

      var result = originalThen.value.call(this, function onResolveWrap(val) {
        // resolve(val); // ?

        if (typeof onResolve === 'function') {
          return onResolve.call(this, val);
        }
      }, function onRejectWrap(val) {
        // reject(val); // ?

        if (typeof onReject === 'function') {
          return onReject.call(this, val);
        }
      })/*.then(resolve, reject)*/,
      stack;

      try {
        throw new Error();
      } catch (e) {
        stack = e.stack;
      }

      // recurciveGetDesc(result, 'then').value.call(result, resolve, reject);
      result.then(resolve, reject);

      var chaingRegistered = PromisesDebugger.register(result, {
        topLevel: false,
        stack: stack,
        parent: registeredData
      });

      return result;
    };

    promise.catch = function(onReject) {
      var result = originalCatch.value.call(this, function onRejectWrap(val) {
        chaingRegistered.setValue({
          type: 'error',
          value: val
        });

        if (typeof onReject === 'function') {
          return onReject.call(this, val);
        }
      }),
      stack;

      try {
        throw new Error();
      } catch (e) {
        stack = e.stack;
      }

      var chaingRegistered = PromisesDebugger.register(result, {
        topLevel: false,
        stack: stack,
        parent: registeredData
      });

      return result;
    };
  };

  var promiseWrap = function(promise, registeredData) {
    var thenWrap = function(onResolve, onReject) {
      var resolve = function(val) {
        chaingRegistered.setValue({
          type: 'value',
          value: val
        });

        return val;
      },
      reject = function(val) {
        chaingRegistered.setValue({
          type: 'error',
          value: val
        });

        return val;
      };

      var result = promise.then(function onResolveWrap(val) {
        if (typeof onResolve === 'function') {
          return onResolve.call(this, val);
        }
      }, function onRejectWrap(val) {
        if (typeof onReject === 'function') {
          return onReject.call(this, val);
        }
      });

      try {
        throw new Error();
      } catch (e) {
        var stack = e.stack;
      }

      result.then(resolve, reject);

      var chaingRegistered = PromisesDebugger.register(result, {
        topLevel: false,
        stack: stack,
        parent: registeredData
      });

      return promiseWrap(result, chaingRegistered);
    },
    catchWrap = function(onReject) {
      var result = promise.catch(function onRejectWrap(val) {
        chaingRegistered.setValue({
          type: 'error',
          value: val
        });

        if (typeof onReject === 'function') {
          return onReject.call(this, val);
        }
      });

      try {
        throw new Error();
      } catch (e) {
        var stack = e.stack;
      }

      var chaingRegistered = PromisesDebugger.register(result, {
        topLevel: false,
        stack: stack,
        parent: registeredData
      });

      return promiseWrap(result, chaingRegistered);
    };

    var proxy = new Proxy(promise, {
      get: function(target, name) {
        if (name === 'then') return thenWrap;
        if (name === 'catch') return catchWrap;

        return target[name];
      }
    });

    PromisesDebugger.promiseByProxy.set(proxy, promise);

    return proxy;
  };

  global.Promise = new Proxy(originalPromise, {
    construct: function(Promise, args) {
      var executor = args[0];

      var promise = new Promise(function(resolve, reject) {
        return executor.call(this, function resolveWrap(val) {
          var value = {
            type: 'value',
            value: val
          };

          if (registeredData) {
            registeredData.setValue(value);
          } else {
            registerValue = value;
          }

          return resolve.call(this, val);
        }, function rejectWrap(val) {
          var value = {
            type: 'error',
            value: val
          };

          if (registeredData) {
            registeredData.setValue(value);
          } else {
            registerValue = value;
          }

          return reject.call(this, val);
        })
      });

      var stack,
        registerValue;

      try {
        throw new Error();
      } catch (e) {
        stack = e.stack;
      }

      var registeredData = PromisesDebugger.register(promise, {
        stack: stack
      });

      if (registerValue) {
        registeredData.setValue(registerValue);
      }

      return promiseWrap(promise, registeredData);
    },
    get: function(target, name) {
      console.log('get', arguments);

      if (fake.hasOwnProperty(name)) {
        return fake[name];
      }

      return target[name];
    }
  });

  var fake = {};

  fake.resolve = function(val) {
    var result = originalPromiseResolve.value.call(originalPromise, val),
      value = {
        type: 'value',
        value: val
      };

    try {
      throw new Error();
    } catch (e) {
      var stack = e.stack;
    }

    var registeredData = PromisesDebugger.register(result, {
      value: value,
      stack: stack
    });

    return promiseWrap(result, registeredData);
  };

  fake.reject = function(val) {
    var result = originalPromiseReject.value.call(originalPromise, val),
      value = {
        type: 'error',
        value: val
      };

    try {
      throw new Error();
    } catch (e) {
      var stack = e.stack;
    }

    var registeredData = PromisesDebugger.register(result, {
      value: value,
      stack: stack
    });

    return promiseWrap(result, registeredData);
  };

  fake.all = function(arr) {
    arr = arr.map(function(proxy) {
      return PromisesDebugger.promiseByProxy.get(proxy);
    });

    var result = originalPromiseAll.value.call(originalPromise, arr);

    try {
      throw new Error();
    } catch (e) {
      var stack = e.stack;
    }

    var registeredData = PromisesDebugger.register(result, {
      stack: stack
    });

    result.then(function(val) {
      registeredData.setValue({
        type: 'value',
        value: val
      });
    }, function(val) {
      registeredData.setValue({
        type: 'error',
        value: val
      });
    });

    return promiseWrap(result, registeredData);
  };

  fake.race = function(arr) {
    arr = arr.map(function(proxy) {
      return PromisesDebugger.promiseByProxy.get(proxy);
    });

    var result = originalPromiseRace.value.call(originalPromise, arr);

    try {
      throw new Error();
    } catch (e) {
      var stack = e.stack;
    }

    var registeredData = PromisesDebugger.register(result, {
      stack: stack
    });

    result.then(function(val) {
      registeredData.setValue({
        type: 'value',
        value: val
      });
    }, function(val) {
      registeredData.setValue({
        type: 'error',
        value: val
      });
    });

    return promiseWrap(result, registeredData);
  };

  window.PromisesDebugger = PromisesDebugger;
}(this));