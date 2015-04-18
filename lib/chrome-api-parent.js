/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const { Ci } = require("chrome");
const tabs = require("sdk/tabs");
const self = require("sdk/self");
const { newURI } = require("sdk/url/utils");
const { search } = require("sdk/places/history");
const { events } = require('sdk/places/events');
const { EventTarget } = require("sdk/event/target");
const { emit, on, off } = require('sdk/event/core');

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

function setup(options) {
  var target = options.target;

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
    var tab = getTabForID(id);
    tab && tab.close();

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
        url: activeTab.url
      }
    })
  });

  target.port.on("tabs:create", function(data) {
    var url = data.options.url;

    tabs.open({
      url: url,
      onLoad: tab => {
        target.port.emit("tabs:created", {
          id: data.id,
          tab: {
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
          url: tab.url,
          title: tab.title
        }
      });
    });
  });
}
exports.setup = setup;

exports.emitter = emitter;

function getURL(path) {
  return self.data.url("./crx/" + path);
}
