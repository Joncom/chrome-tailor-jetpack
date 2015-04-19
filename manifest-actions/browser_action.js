/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const self = require("sdk/self");
const { ActionButton } = require("sdk/ui/button/action");
const { Panel } = require("sdk/panel");
const { setTimeout } = require("sdk/timers");
const { emit, on, off } = require('sdk/event/core');
const { getURL } = require("../crx");

const { setup, emitter } = require("../lib/chrome-api-parent");

function create(options) {
  let icon = options.default_icon || "";
  let label = options.default_title || "blank";
  let url = options.default_popup || "";

  let button = ActionButton({
    id: "my-button",
    label: label,
    icon: getURL(icon),
    onClick: function(state) {
      if (url) {
        let panel = Panel({
          contentURL: getURL(url),
          contentScriptWhen: "start",
          contentScriptFile: self.data.url("chrome-api-child.js"),
          contentScriptOptions: {
            rootURI: getURL("")
          },
          onHide: () => setTimeout(() => panel.destroy(), 500)
        });

        setup({ target: panel });

        panel.show({
          position: button
        });
      }

      emit(emitter, "browser-action:onclicked");
    }
  });

  return button;
}
module.exports = create;
