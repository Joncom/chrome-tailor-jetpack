/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const { Ci } = require("chrome");
const tabs = require("sdk/tabs");
const self = require("sdk/self");
const Request = require("sdk/request").Request;
const { PageMod } = require("sdk/page-mod");
const { newURI } = require("sdk/url/utils");
const { search } = require("sdk/places/history");
const { events } = require('sdk/places/events');
const { EventTarget } = require("sdk/event/target");
const { emit, on, off } = require('sdk/event/core');
const ss = require("sdk/simple-storage");

const QUOTA_BYTES = 5242880; // 5 MB

const { PlacesUtils: {
  history: hstsrv,
  asyncHistory
} } = require("resource://gre/modules/PlacesUtils.jsm");

const emitter = EventTarget();

var tabIndex = 0;
var tabsMap = new WeakMap();
function getTabID(tab) {
  if (!tabsMap.has(tab)) {
    tabsMap.set(tab, tabIndex++);
  }
  return tabsMap.get(tab);
}
exports.getTabID = getTabID;

function getTabForID(id) {
  for (let i = tabs.length -1; i >= 0; i--) {
    let tab = tabs[i];
    let tabID = getTabID(tab);
    if (tabID == id) {
      return tab;
    }
  }
  return null;
}
exports.getTabForID = getTabForID;

function setup(options) {
  var target = options.target;

  target.port.on("chrome.browserAction.setIcon", function(path) {
    options.button.state("window", {
      icon: path
    });
  });

  target.port.on("chrome.proxy.settings.set", function(data) {
    var service = require("sdk/preferences/service");
    service.set("network.proxy.autoconfig_url", data.autoconfig_url);
    service.set("network.proxy.type", 2); // Proxy auto-configuration (PAC)
    target.port.emit("chrome.proxy.settings.set::done", { id: data.id });
  });

  target.port.on("chrome.proxy.settings.clear", function(callID) {
    var service = require("sdk/preferences/service");
    service.reset("network.proxy.autoconfig_url");
    service.reset("network.proxy.type");
    target.port.emit("chrome.proxy.settings.set::done", callID);
  });

  target.port.on("request", function(options) {
    var id = options.id;
    delete options.id;
    options.onComplete = function(response) {
      var payload = {
        id: id,
        response: {
          url: response.url,
          text: response.text,
          json: response.json,
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          anonymouse: response.anonymouse
        }
      };
      target.port.emit("request:response", payload);
    }
    Request(options).get();
  });

  target.port.on("tabs:duplicate", function(data) {
    var tabID = data.tabId;
    var id = data.id;
    var url = getTabForID(tabID).url;

    tabs.open({
      url: url,
      onLoad: tab => {
        target.port.emit("tabs:duplicated", {
          id: id,
          tab: {
            id: getTabID(tab),
            url: url,
            title: tab.title,
            // TODO: implement this!
            favIconUrl: undefined
          }
        });
      }
    });
  });

  target.port.on("tabs:remove", function(data) {
    var tabIDs = (Array.isArray(data.tabs) ? data.tabs : [ data.tabs ]).sort();
    var id = data.id;
    for (let i = tabIDs.length - 1; i >= 0; i--) {
      let tab = getTabForID(tabIDs[i]);
      tab && tab.close();
    }

    target.port.emit("tabs:removed", {
      id: id
    });
  });

  target.port.on("tabs:query", function(data) {
    var result = [];
    for (let tab of tabs) {
      result.push({
        url: tab.url
      });
    }
    target.port.emit("tabs:query:result", {
      id: data.id,
      tabs: result
    })
  });

  target.port.on("tabs:get:current", function(data) {
    var activeTab = tabs.activeTab;
    target.port.emit("tabs:got:current", {
      id: data.id,
      tab: {
        id: getTabID(activeTab),
        url: activeTab.url,
        title: activeTab.title
      }
    })
  });

  target.port.on("runtime:send:message", function(data) {
    emit(emitter, "runtime:send:message", data);
  });

  if (!(target instanceof PageMod)) {
    on(emitter, "runtime:send:message", function(data) {
      target.port.emit("runtime:send:message", data);
    });

    target.port.on("runtime:message:response:callback", function(data) {
      emit(emitter, "runtime:message:response:callback", data);
    });
  }

  on(emitter, "runtime:message:response:callback", function(data) {
    target.port.emit("runtime:message:response:callback", data);
  });

  target.port.on("tabs:send:message", function(data) {
    emit(emitter, "tabs:send:message", data);
  });

  target.port.on("tabs:message:response", function(data) {
    emit(emitter, "tabs:got:message", data);
  });

  function tabsGotMessage(data) {
    target.port.emit("tabs:got:message", data);
  }
  on(emitter, "tabs:got:message", tabsGotMessage);
  target.once("detach", () => {
    off(emitter, "tabs:got:message", tabsGotMessage);
  })

  target.port.on("tabs:create", function(data) {
    var url = data.options.url;

    tabs.open({
      url: url,
      onLoad: tab => {
        target.port.emit("tabs:created", {
          id: data.id,
          tab: {
            id: getTabID(tab),
            url: url,
            title: tab.title,
            // TODO: implement this!
            favIconUrl: undefined
          }
        });
      }
    });
  });

  target.port.on("tabs:execute:script", function(data) {
    let tab = (!data.tabId) ? tabs.activeTab : tabs[tabId];
    let runAt = data.details.runAt ? data.details.runAt.replace(/^document_/i, "") : "ready";
    if (runAt == "idle") {
      runAt = "ready";
    }

    if (data.details.code) {
      tab.attach({
        contentScriptWhen: runAt,
        contentScript: data.details.code,
        onAttach: function() {
          target.port.emit("tabs:executed:script", {
            id: data.id
          });
        }
      });
    }
    else {
      tab.attach({
        contentScriptWhen: runAt,
        contentScriptFile: getURL(data.details.file),
        onAttach: function() {
          target.port.emit("tabs:executed:script");
        }
      });
    }
  });

  target.port.on("history:delete:url", function(data) {
    var url = data.url;

    hstsrv.removePage(newURI(url));
    target.port.emit("history:deleted:url", {
      id: data.id
    });
  });

  target.port.on("history:delete:all", function(data) {
    hstsrv.removeAllPages();
    target.port.emit("history:deleted:all", {
      id: data.id
    });
  });

  target.port.on("history:add:url", function(data) {
    let url = data.url;
    let now = Date.now() * 1000;
    let transitionLink = Ci.nsINavHistoryService.TRANSITION_LINK;

    asyncHistory.updatePlaces({
      uri: newURI(url),
      visits: [{visitDate: now, transitionType: transitionLink}]
    }, {
      handleError: () => {},
      handleResult: () => {},
      handleCompletion: () => {
        target.port.emit("history:added:url", {
          id: data.id
        });
      }
    });
  });

  target.port.on("history:get:topsites", function(data) {
    search({}, {
      count: 8,
      sort: "visitCount",
      descending: true
    }).on("end", function (results) {
      target.port.emit("history:got:topsites", {
        id: data.id,
        urls: results
      });
    });
  });

  target.port.on("browser-action:onclick", function(data) {
    on(emitter, "browser-action:onclicked", function() {
      let tab = tabs.activeTab;
      target.port.emit("browser-action:onclicked", {
        id: data.id,
        tab: {
          id: getTabID(tab),
          url: tab.url,
          title: tab.title
        }
      });
    });
  });

  target.port.on("storage:get:quota", function(data) {
    var keys = data.keys;

    if (typeof keys == "string") {
      keys = [ keys ];
    }

    // handle case where a blank list is provided
    if (Array.isArray(keys)) {
      if (keys.length == 0) {
        target.port.emit("storage:get:quota:callback", {
          id: data.id,
          bytesInUse: 0
        });
      }
    }

    // TODO: if keys are provided, then only get the usage of those


    // handle case where total usage is desired
    target.port.emit("storage:get:quota:callback", {
      id: data.id,
      bytesInUse: QUOTA_BYTES * ss.quotaUsage
    });
    return null;
  });

  target.port.on("storage:local:get", function(data) {
    var keys = data.keys;
    var defaults = {};

    if (typeof keys == "object") {
      defaults = keys;
      keys = Object.keys(keys);
    }
    else if (typeof keys == "string") {
      keys = [ keys ];
    }

    let items = {};
    keys.forEach((key) => {
      items[key] = ss.storage[key] || defaults[key];
    });

    target.port.emit("storage:local:got", {
      id: data.id,
      items: items
    })
  });

  target.port.on("storage:local:set", function(data) {
    var { items } = data;
    var defaults = {};

    if (typeof keys == "object") {
      defaults = keys;
      keys = Object.keys(keys);
    }
    else if (typeof keys == "string") {
      keys = [ keys ];
    }

    Object.keys(items).forEach((key) => {
      ss.storage[key] = items[key];
    });

    target.port.emit("storage:local:set:callback", {
      id: data.id
    })
  });
}
exports.setup = setup;

exports.emitter = emitter;

function getURL(path) {
  return self.data.url("./crx/" + path);
}
