/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Log.jsm");

Cu.import("chrome://marionette/content/error.js");

XPCOMUtils.defineLazyModuleGetter(
    this, "setInterval", "resource://gre/modules/Timer.jsm");
XPCOMUtils.defineLazyModuleGetter(
    this, "clearInterval", "resource://gre/modules/Timer.jsm");

XPCOMUtils.defineLazyGetter(this, "service",
    () => Cc["@mozilla.org/accessibilityService;1"].getService(Ci.nsIAccessibilityService));

this.EXPORTED_SYMBOLS = ["accessibility"];

const logger = Log.repository.getLogger("Marionette");

/**
 * Number of attempts to get an accessible object for an element.
 * We attempt more than once because accessible tree can be out of sync
 * with the DOM tree for a short period of time.
 */
const GET_ACCESSIBLE_ATTEMPTS = 100;

/**
 * An interval between attempts to retrieve an accessible object for an
 * element.
 */
const GET_ACCESSIBLE_ATTEMPT_INTERVAL = 10;

this.accessibility = {};

/**
 * Accessible states used to check element"s state from the accessiblity API
 * perspective.
 */
accessibility.State = {
  Unavailable: Ci.nsIAccessibleStates.STATE_UNAVAILABLE,
  Focusable: Ci.nsIAccessibleStates.STATE_FOCUSABLE,
  Selectable: Ci.nsIAccessibleStates.STATE_SELECTABLE,
  Selected: Ci.nsIAccessibleStates.STATE_SELECTED,
};

/**
 * Accessible object roles that support some action.
 */
accessibility.ActionableRoles = new Set([
  "checkbutton",
  "check menu item",
  "check rich option",
  "combobox",
  "combobox option",
  "entry",
  "key",
  "link",
  "listbox option",
  "listbox rich option",
  "menuitem",
  "option",
  "outlineitem",
  "pagetab",
  "pushbutton",
  "radiobutton",
  "radio menu item",
  "rowheader",
  "slider",
  "spinbutton",
  "switch",
]);


/**
 * Factory function that constructs a new {@code accessibility.Checks}
 * object with enforced strictness or not.
 */
accessibility.get = function(strict = false) {
  return new accessibility.Checks(!!strict);
};

/**
 * Component responsible for interacting with platform accessibility
 * API.
 *
 * Its methods serve as wrappers for testing content and chrome
 * accessibility as well as accessibility of user interactions.
 */
accessibility.Checks = class {

  /**
   * @param {boolean} strict
   *     Flag indicating whether the accessibility issue should be logged
   *     or cause an error to be thrown.  Default is to log to stdout.
   */
  constructor(strict) {
    this.strict = strict;
  }

  /**
   * Get an accessible object for an element.
   *
   * @param {DOMElement|XULElement} element
   *     Element to get the accessible object for.
   * @param {boolean=} mustHaveAccessible
   *     Flag indicating that the element must have an accessible object.
   *     Defaults to not require this.
   *
   * @return {nsIAccessible}
   *     Accessibility object for the given element.
   */
  getAccessible(element, mustHaveAccessible = false) {
    return new Promise((resolve, reject) => {
      let acc = service.getAccessibleFor(element);

      // if accessible object is found, return it;
      // if it is not required, also resolve
      if (acc || !mustHaveAccessible) {
        resolve(acc);

      // if we must have an accessible but are strict,
      // reject now and avoid polling for an accessible object
      } else if (mustHaveAccessible && !this.strict) {
        reject();

      // if we require an accessible object, we need to poll for it
      // because accessible tree might be
      // out of sync with DOM tree for a short time
      } else {
        let attempts = GET_ACCESSIBLE_ATTEMPTS;
        let intervalId = setInterval(() => {
          let acc = service.getAccessibleFor(element);
          if (acc || --attempts <= 0) {
            clearInterval(intervalId);
            if (acc) {
              resolve(acc);
            } else {
              reject();
            }
          }
        }, GET_ACCESSIBLE_ATTEMPT_INTERVAL);
      }
    }).catch(() => this.error(
        "Element does not have an accessible object", element));
  };

  /**
   * Test if the accessible has a role that supports some arbitrary
   * action.
   *
   * @param {nsIAccessible} accessible
   *     Accessible object.
   *
   * @return {boolean}
   *     True if an actionable role is found on the accessible, false
   *     otherwise.
   */
  isActionableRole(accessible) {
    return accessibility.ActionableRoles.has(
        service.getStringRole(accessible.role));
  }

  /**
   * Test if an accessible has at least one action that it supports.
   *
   * @param {nsIAccessible} accessible
   *     Accessible object.
   *
   * @return {boolean}
   *     True if the accessible has at least one supported action,
   *     false otherwise.
   */
  hasActionCount(accessible) {
    return accessible.actionCount > 0;
  }

  /**
   * Test if an accessible has a valid name.
   *
   * @param {nsIAccessible} accessible
   *     Accessible object.
   *
   * @return {boolean}
   *     True if the accessible has a non-empty valid name, or false if
   *     this is not the case.
   */
  hasValidName(accessible) {
    return accessible.name && accessible.name.trim();
  }

  /**
   * Test if an accessible has a {@code hidden} attribute.
   *
   * @param {nsIAccessible} accessible
   *     Accessible object.
   *
   * @return {boolean}
   *     True if the accesible object has a {@code hidden} attribute,
   *     false otherwise.
   */
  hasHiddenAttribute(accessible) {
    let hidden = false;
    try {
      hidden = accessible.attributes.getStringProperty("hidden");
    } finally {
      // if the property is missing, error will be thrown
      return hidden && hidden === "true";
    }
  }

  /**
   * Verify if an accessible has a given state.
   * Test if an accessible has a given state.
   *
   * @param {nsIAccessible} accessible
   *     Accessible object to test.
   * @param {number} stateToMatch
   *     State to match.
   *
   * @return {boolean}
   *     True if |accessible| has |stateToMatch|, false otherwise.
   */
  matchState(accessible, stateToMatch) {
    let state = {};
    accessible.getState(state, {});
    return !!(state.value & stateToMatch);
  }

  /**
   * Test if an accessible is hidden from the user.
   *
   * @param {nsIAccessible} accessible
   *     Accessible object.
   *
   * @return {boolean}
   *     True if element is hidden from user, false otherwise.
   */
  isHidden(accessible) {
    while (accessible) {
      if (this.hasHiddenAttribute(accessible)) {
        return true;
      }
      accessible = accessible.parent;
    }
    return false;
  }

  /**
   * Test if the element's visible state corresponds to its accessibility
   * API visibility.
   *
   * @param {nsIAccessible} accessible
   *     Accessible object.
   * @param {DOMElement|XULElement} element
   *     Element associated with |accessible|.
   * @param {boolean} visible
   *     Visibility state of |element|.
   *
   * @throws ElementNotAccessibleError
   *     If |element|'s visibility state does not correspond to
   *     |accessible|'s.
   */
  checkVisible(accessible, element, visible) {
    if (!accessible) {
      return;
    }

    let hiddenAccessibility = this.isHidden(accessible);

    let message;
    if (visible && hiddenAccessibility) {
      message = "Element is not currently visible via the accessibility API " +
          "and may not be manipulated by it";
    } else if (!visible && !hiddenAccessibility) {
      message = "Element is currently only visible via the accessibility API " +
          "and can be manipulated by it";
    }
    this.error(message, element);
  }

  /**
   * Test if the element's unavailable accessibility state matches the
   * enabled state.
   *
   * @param {nsIAccessible} accessible
   *     Accessible object.
   * @param {DOMElement|XULElement} element
   *     Element associated with |accessible|.
   * @param {boolean} enabled
   *     Enabled state of |element|.
   *
   * @throws ElementNotAccessibleError
   *     If |element|'s enabled state does not match |accessible|'s.
   */
  checkEnabled(accessible, element, enabled) {
    if (!accessible) {
      return;
    }

    let win = element.ownerDocument.defaultView;
    let disabledAccessibility = this.matchState(
        accessible, accessibility.State.Unavailable);
    let explorable = win.getComputedStyle(element)
        .getPropertyValue("pointer-events") !== "none";

    let message;
    if (!explorable && !disabledAccessibility) {
      message = "Element is enabled but is not explorable via the " +
          "accessibility API";
    } else if (enabled && disabledAccessibility) {
      message = "Element is enabled but disabled via the accessibility API";
    } else if (!enabled && !disabledAccessibility) {
      message = "Element is disabled but enabled via the accessibility API";
    }
    this.error(message, element);
  }

  /**
   * Test if it is possible to activate an element with the accessibility
   * API.
   *
   * @param {nsIAccessible} accessible
   *     Accessible object.
   * @param {DOMElement|XULElement} element
   *     Element associated with |accessible|.
   *
   * @throws ElementNotAccessibleError
   *     If it is impossible to activate |element| with |accessible|.
   */
  checkActionable(accessible, element) {
    if (!accessible) {
      return;
    }

    let message;
    if (!this.hasActionCount(accessible)) {
      message = "Element does not support any accessible actions";
    } else if (!this.isActionableRole(accessible)) {
      message = "Element does not have a correct accessibility role " +
          "and may not be manipulated via the accessibility API";
    } else if (!this.hasValidName(accessible)) {
      message = "Element is missing an accessible name";
    } else if (!this.matchState(accessible, accessibility.State.Focusable)) {
      message = "Element is not focusable via the accessibility API";
    }

    this.error(message, element);
  }

  /**
   * Test that an element's selected state corresponds to its
   * accessibility API selected state.
   *
   * @param {nsIAccessible} accessible
   *     Accessible object.
   * @param {DOMElement|XULElement}
   *     Element associated with |accessible|.
   * @param {boolean} selected
   *     The |element|s selected state.
   *
   * @throws ElementNotAccessibleError
   *     If |element|'s selected state does not correspond to
   *     |accessible|'s.
   */
  checkSelected(accessible, element, selected) {
    if (!accessible) {
      return;
    }

    // element is not selectable via the accessibility API
    if (!this.matchState(accessible, accessibility.State.Selectable)) {
      return;
    }

    let selectedAccessibility = this.matchState(accessible, accessibility.State.Selected);

    let message;
    if (selected && !selectedAccessibility) {
      message = "Element is selected but not selected via the accessibility API";
    } else if (!selected && selectedAccessibility) {
      message = "Element is not selected but selected via the accessibility API";
    }
    this.error(message, element);
  }

  /**
   * Throw an error if strict accessibility checks are enforced and log
   * the error to the log.
   *
   * @param {string} message
   * @param {DOMElement|XULElement} element
   *     Element that caused an error.
   *
   * @throws ElementNotAccessibleError
   *     If |strict| is true.
   */
  error(message, element) {
    if (!message) {
      return;
    }
    if (element) {
      let {id, tagName, className} = element;
      message += `: id: ${id}, tagName: ${tagName}, className: ${className}`;
    }
    if (this.strict) {
      throw new ElementNotAccessibleError(message);
    }
    logger.debug(message);
  }

};
