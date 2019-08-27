module.exports = function(RED) {
    const retry = require('requestretry');

    var _sid = null;

    function request(uri, body, callback) {
      retry({
        method: "POST",
        uri: uri,
        body: body,
        json: true,
        strictSSL: false,
        timeout: 1500,
        maxAttempts: 3,
        retryDelay: 100
      }, callback);
    }

    function login(node, callback) {
      request(
        "https://" + node.ip_address + "/dyn/login.json",
        {
          right: node.right,
          pass: node.credentials.password
        }, (error, response, body) => {
          var result;

          if (error) {
            node.error(error);
          } else if (body) {
            if (body.err) {
              node.error(body);
            } else if (body.result) {
              result = body.result.sid;
              _sid = body.result.sid;

              node.log("session created: " + body.result.sid);
            }
          }

          if (callback) {
            callback(result);
          }
        }
      );
    }

    function getValues(node, callback, onSessionTimeout) {
      request(
        "https://" + node.ip_address + "/dyn/getValues.json?sid=" + _sid,
        {
          "destDev": [],
          "keys": [
            "6100_0046E500", // phase 1 voltage
            "6100_0046E600", // phase 2 voltage
            "6100_0046E700", // phase 3 voltage
            "6100_40263F00", // power
            "6100_40463600", // grid feedin
            "6100_40463700", // grid consumption
          ]
        }, (error, response, body) => {
          if (error) {
            node.error(error);
          } else if (body) {
            if (body.err) {
              if (body.err == "401") {
                if (onSessionTimeout) {
                  onSessionTimeout();
                }
              } else {
                node.error(body);
              }
            } else if (body.result) {
              var result = {};

              result.grid_feedin = 0;
              result.grid_consumption = 0;
              result.power = 0;

              for (var id in body.result) {
                const set = body.result[id];

                for (var key in set) {
                  const value = set[key];

                  if (value) {
                    for (var elm of value["1"]) {
                      if (elm.val) {
                        if (key == "6100_0046E500") {
                          result.phase1_voltage = elm.val / 100;
                        } else if (key == "6100_0046E600") {
                          result.phase2_voltage = elm.val / 100;
                        } else if (key == "6100_0046E700") {
                          result.phase3_voltage = elm.val / 100;
                        } else if (key == "6100_40463600") {
                          result.grid_feedin = elm.val;
                        } else if (key == "6100_40463700") {
                          result.grid_consumption = elm.val;
                        } else if (key == "6100_40263F00") {
                          result.power = elm.val;
                        }
                      }
                    }
                  }
                }
              }

              if (callback) {
                callback(result);
              }
            }
          }
        }
      );
    }

    function getFreeSessionsCount(node, callback) {
      request(
        "https://" + node.ip_address + "/dyn/sessionCheck.json",
        {},
        (error, response, body) => {
          if (error) {
            node.error(error);
          } else if (body) {
            if (body.result && body.result.cntFreeSess != null) {
              if (callback) {
                callback(body.result.cntFreeSess);
              }
            } else {
              node.log(body);
            }
          }
        }
      );
    }

    function logout(node, callback) {
      node.log("https://" + node.ip_address + "/dyn/logout.json?sid=" + _sid);

      request(
        "https://" + node.ip_address + "/dyn/logout.json?sid=" + _sid,
        {},
        (error, response, body) => {
          var result = false;

          if (error) {
            node.error(error);
          } else if (body) {
            if (body.result && body.result.login != null) {
              if (body.result.isLogin == false) {
                result = true;

                node.log("session closed: " + _sid);
              }
            } else {
              node.log(body);
            }
          }

          if (callback) {
            callback(result);
          }
        }
      );
    }

    function query(node, retries, completion) {
      if (retries > 0) {
        if (_sid) {
          getValues(node, (result) => {
            getFreeSessionsCount(node, (count) => {
              result.available_sessions = count;

              completion(result);
            })
          }, () => {
            login(node, (sid) => {
              query(node, retries - 1, completion);
            });
          })
        } else {
          login(node, (sid) => {
            query(node, retries - 1, completion);
          });
        }
      }
    }

    function SMAWebconnectNode(config) {
      RED.nodes.createNode(this, config);
      this.ip_address = config.ip_address;
      this.right = config.right;
      var node = this;
      node.on('input', function(msg) {
        query(node, 3, (result) => {
          msg.payload = result;
          node.send(msg);
        });
      });
      node.on('close', function(done) {
        logout(node, (result) => {
          done();
        });
      });
    }

    RED.nodes.registerType("sma-webconnect", SMAWebconnectNode, {
      credentials: {
        password: { type: "password" }
      }
    });
};