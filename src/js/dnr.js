/*******************************************************************************

    uMatrix - a browser extension to block requests.
    Copyright (C) 2014-present The uMatrix/uBlock Origin authors

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uMatrix
*/

'use strict';

/*******************************************************************************

  Manifest V3: compile the temporary matrix into declarativeNetRequest rules.

  With Manifest V3 the extension can no longer decide the fate of a network
  request from within a webRequest listener, all enforcement has to be
  expressed as declarativeNetRequest rules ahead of time. The webRequest
  listeners in traffic.js are still used, but only to observe requests (stats,
  logger, popup).

  The key observation which makes an exact translation possible: for a given
  scope (the hostname of the page in a tab), the verdict of
  `Matrix.evaluateCellZXY(scope, hostname, type)` only depends on the
  nearest ancestor of `hostname` (itself included) which is the destination
  of a rule applying to that scope. So for each such "relevant" destination
  the verdict is computed with uMatrix's own evaluation code, and emitted as
  a rule matching that destination and its subdomains, with a priority
  increasing with the number of labels of the destination, so that the most
  specific destination wins.

  - Subresources are filtered by per-tab session rules (`tabIds`), since the
    scope is the hostname of the top-level document of a tab, which is not
    something a declarativeNetRequest condition can express.
  - Top-level documents are filtered by global session rules, since for them
    the scope is the hostname of the document itself.
  - The ubiquitous blocklist (hosts files) is compiled into dynamic rules,
    one per label count, with a priority lower than that of a per-tab rule
    for a destination with the same label count.
  - Header modifications (cookie removal, CSP injection, referrer removal)
    can't rely on priorities, since an `allow` rule with a higher priority
    cancels them. They are expressed as regions instead: a rule for each
    destination where the verdict flips, excluding the descendants where it
    flips back.

  Known differences with Manifest V2:
  - A spoofed referrer can't be computed per request, so the `Referer`
    header of third-party requests is removed instead of spoofed.
  - Partial IP addresses and IPv6 addresses can't be used as destinations.
  - When a tab navigates to a different site, its subresources are filtered
    according to the new scope only once the rules for the tab have been
    updated, which normally happens before the main document is received.

**/

µMatrix.dnr = (( ) => {

/******************************************************************************/

const browser = self.browser;

if (
    vAPI.mv3 !== true ||
    browser.declarativeNetRequest instanceof Object === false
) {
    return;
}

const dnr = browser.declarativeNetRequest;
const µm = µMatrix;

/******************************************************************************/

// uMatrix type => declarativeNetRequest resource types, as per
// FilteringContext.requestTypeNormalizer. `doc` is top-level documents only,
// handled separately.

const resourceTypesFromType = new Map([
    [  'frame', [ 'sub_frame' ] ],
    [    'css', [ 'stylesheet', 'font' ] ],
    [  'image', [ 'image' ] ],
    [  'media', [ 'media', 'object' ] ],
    [ 'script', [ 'script' ] ],
    [  'fetch', [ 'xmlhttprequest', 'websocket' ] ],
    [  'other', [ 'other', 'ping', 'csp_report', 'webbundle', 'webtransport' ] ],
]);

const subresourceTypes = Array.from(resourceTypesFromType.keys());

const allSubresourceTypes = [].concat(...resourceTypesFromType.values());

const frameTypes = [ 'sub_frame' ];
const mainFrameTypes = [ 'main_frame' ];

// Priorities. Block/allow rules: 10 per label, per-tab and top-level
// document rules get +5 so that they override blocklist rules with the same
// number of labels. Rules modifying headers must be above all block/allow
// rules except the matrix-off ones, which are meant to cancel them.

const PRIORITY_PER_LABEL = 10;
const PRIORITY_RULE_BONUS = 5;
const PRIORITY_HEADERS = 5000;
const PRIORITY_MATRIX_OFF = 9000;
const PRIORITY_HTTPS_STRICT = 9500;
const PRIORITY_PING = 9600;

// Session rule ids below this are reserved (see vAPI.dnrReservedRuleIds).
const FIRST_RULE_ID = 100;

const MAIN_FRAME_GROUP = '';

// A hostname which can't be a relevant destination nor be first-party to
// a scope, used to compute the verdict for "everything else".
const UNMATCHED_HOSTNAME = 'umatrix-unmatched.invalid';
const UNMATCHED_LABEL = 'umatrix-unmatched.';

/******************************************************************************/

const reValidHostname = /^[0-9a-z_-]+(?:\.[0-9a-z_-]+)*$/;
const reIPv4 = /^\d+\.\d+\.\d+\.\d+$/;
const reIPv4Partial = /^\d+(?:\.\d+){0,2}$/;

// Whether a hostname can be used in `requestDomains`.
const isDestination = function(hn) {
    if ( reValidHostname.test(hn) === false ) { return false; }
    if ( reIPv4Partial.test(hn) ) { return false; }
    return true;
};

const labelCount = function(hn) {
    if ( reIPv4.test(hn) ) { return 4; }
    let n = 1;
    let pos = 0;
    while ( (pos = hn.indexOf('.', pos) + 1) !== 0 ) { n += 1; }
    return n;
};

// Nearest ancestor of `hn` (excluding itself) which is in `set`, or '' if
// none.
const nearestAncestorIn = function(hn, set) {
    for (;;) {
        hn = µm.Matrix.toBroaderHostname(hn);
        if ( hn === '' || hn === '*' ) { return ''; }
        if ( set.has(hn) ) { return hn; }
    }
};

const domainFromHostname = function(hn) {
    return µm.URI.domainFromHostname(hn) || hn;
};

/******************************************************************************/

// Index of the matrix: source hostname => destination hostnames.

let matrixIndex;

const getMatrixIndex = function() {
    if ( matrixIndex !== undefined ) { return matrixIndex; }
    const matrix = µm.tMatrix;
    const destinations = new Map();
    const hostnames = new Set();
    for ( const key of matrix.rules.keys() ) {
        const pos = key.indexOf(' ');
        const src = key.slice(0, pos);
        const des = key.slice(pos + 1);
        let entry = destinations.get(src);
        if ( entry === undefined ) {
            entry = new Set();
            destinations.set(src, entry);
        }
        entry.add(des);
        hostnames.add(src).add(des);
    }
    for ( const src of matrix.switches.keys() ) {
        hostnames.add(src);
    }
    hostnames.delete('*');
    hostnames.delete('1st-party');
    for ( const hn of hostnames ) {
        if ( isDestination(hn) === false ) { hostnames.delete(hn); }
    }
    matrixIndex = { destinations, hostnames };
    return matrixIndex;
};

/******************************************************************************/

// Emit a set of rules for hostname-based verdicts. `verdicts` maps relevant
// hostnames to a key identifying the verdict for each type; `rootVerdict` is
// the verdict for all other hostnames. `rulesFromVerdict(verdict)` returns
// the actions and types to emit: [ [ action, resourceTypes ], ... ].

const emitPrioritizedRules = function(out, verdicts, rootVerdict, rulesFromVerdict, extraCondition) {
    const groups = new Map();
    for ( const [ hn, verdict ] of verdicts ) {
        const key = `${labelCount(hn)}\n${verdict}`;
        let group = groups.get(key);
        if ( group === undefined ) {
            group = {
                priority: labelCount(hn) * PRIORITY_PER_LABEL + PRIORITY_RULE_BONUS,
                verdict,
                requestDomains: [],
            };
            groups.set(key, group);
        }
        group.requestDomains.push(hn);
    }
    groups.set('', {
        priority: PRIORITY_RULE_BONUS,
        verdict: rootVerdict,
        requestDomains: undefined,
    });
    for ( const group of groups.values() ) {
        for ( const [ action, resourceTypes ] of rulesFromVerdict(group.verdict) ) {
            if ( resourceTypes.length === 0 ) { continue; }
            const condition = Object.assign({ resourceTypes }, extraCondition);
            if ( group.requestDomains !== undefined ) {
                condition.requestDomains = group.requestDomains;
            }
            out.push({ priority: group.priority, action, condition });
        }
    }
};

// Emit rules for the regions where `isOn(hn)` is true, for header
// modifications. `hostnames` are the hostnames where the state may change.

const emitRegionRules = function(out, hostnames, isOn, rootIsOn, action, resourceTypes, extraCondition) {
    const states = new Map();
    for ( const hn of hostnames ) {
        states.set(hn, isOn(hn));
    }
    const parentState = hn => {
        const parent = nearestAncestorIn(hn, states);
        return parent !== '' ? states.get(parent) : rootIsOn;
    };
    // The hostnames where the state flips, grouped by their parent region.
    const regions = new Map([ [ '', [] ] ]);
    const boundaries = [];
    for ( const [ hn, on ] of states ) {
        if ( on === parentState(hn) ) { continue; }
        boundaries.push(hn);
        if ( on ) { regions.set(hn, []); }
    }
    for ( const hn of boundaries ) {
        if ( states.get(hn) ) { continue; }
        // A hole: exclude from the nearest enclosing region.
        let region = hn;
        for (;;) {
            region = nearestAncestorIn(region, states);
            if ( region === '' || regions.has(region) ) { break; }
        }
        regions.get(region).push(hn);
    }
    for ( const [ region, excluded ] of regions ) {
        if ( region === '' && rootIsOn === false ) { continue; }
        const condition = Object.assign({ resourceTypes }, extraCondition);
        if ( region !== '' ) {
            condition.requestDomains = [ region ];
        }
        if ( excluded.length !== 0 ) {
            condition.excludedRequestDomains = excluded;
        }
        out.push({ priority: PRIORITY_HEADERS, action, condition });
    }
};

const cspAction = function(value) {
    return {
        type: 'modifyHeaders',
        responseHeaders: [ {
            header: 'content-security-policy',
            operation: 'append',
            value,
        } ],
    };
};

const removeCookieAction = {
    type: 'modifyHeaders',
    requestHeaders: [ { header: 'cookie', operation: 'remove' } ],
};

const removeReferrerAction = {
    type: 'modifyHeaders',
    requestHeaders: [ { header: 'referer', operation: 'remove' } ],
};

/******************************************************************************/

// Rules for subresources requested from tabs whose top-level document is
// from `scope`.

const compileScope = function(scope, secure, tabIds) {
    const matrix = µm.tMatrix;
    const out = [];
    const extraCondition = { tabIds };

    // https-strict applies whatever the matrix says.
    if ( secure && matrix.evaluateSwitchZ('https-strict', scope) ) {
        for ( const urlFilter of [ '|http:', '|ws:' ] ) {
            out.push({
                priority: PRIORITY_HTTPS_STRICT,
                action: { type: 'block' },
                condition: { urlFilter, resourceTypes: allSubresourceTypes, tabIds },
            });
        }
    }

    if ( matrix.evaluateSwitchZ('matrix-off', scope) ) {
        out.push({
            priority: PRIORITY_MATRIX_OFF,
            action: { type: 'allow' },
            condition: { resourceTypes: allSubresourceTypes, tabIds },
        });
        return out;
    }

    // Relevant destinations: those of rules applying to the scope, and the
    // domain of the scope, since the evaluation differs for first-party
    // destinations.
    const { destinations } = getMatrixIndex();
    const relevant = new Set();
    for ( let src = scope; src !== ''; src = µm.Matrix.toBroaderHostname(src) ) {
        const entry = destinations.get(src);
        if ( entry === undefined ) { continue; }
        for ( const des of entry ) {
            if ( isDestination(des) ) { relevant.add(des); }
        }
    }
    const scopeDomain = domainFromHostname(scope);
    if ( isDestination(scopeDomain) ) {
        relevant.add(scopeDomain);
    }

    const mustBlock = (hn, type) =>
        (matrix.evaluateCellZXY(scope, hn, type) & 3) === µm.Matrix.Red;
    const verdictOf = hn => {
        let bits = 0;
        for ( let i = 0; i < subresourceTypes.length; i++ ) {
            if ( mustBlock(hn, subresourceTypes[i]) ) { bits |= 1 << i; }
        }
        return bits;
    };
    const rulesFromVerdict = bits => {
        const blocked = [], allowed = [];
        for ( let i = 0; i < subresourceTypes.length; i++ ) {
            const types = resourceTypesFromType.get(subresourceTypes[i]);
            ((bits & (1 << i)) !== 0 ? blocked : allowed).push(...types);
        }
        return [
            [ { type: 'block' }, blocked ],
            [ { type: 'allow' }, allowed ],
        ];
    };
    const verdicts = new Map();
    for ( const hn of relevant ) {
        verdicts.set(hn, verdictOf(hn));
    }
    emitPrioritizedRules(
        out,
        verdicts,
        verdictOf(UNMATCHED_HOSTNAME),
        rulesFromVerdict,
        extraCondition
    );

    emitRegionRules(
        out,
        relevant,
        hn => mustBlock(hn, 'cookie'),
        mustBlock(UNMATCHED_HOSTNAME, 'cookie'),
        removeCookieAction,
        allSubresourceTypes,
        extraCondition
    );
    emitRegionRules(
        out,
        relevant,
        hn => mustBlock(hn, 'script'),
        mustBlock(UNMATCHED_HOSTNAME, 'script'),
        cspAction(µm.cspNoInlineScript),
        frameTypes,
        extraCondition
    );
    emitRegionRules(
        out,
        relevant,
        hn => mustBlock(hn, 'css'),
        mustBlock(UNMATCHED_HOSTNAME, 'css'),
        cspAction(µm.cspNoInlineStyle),
        frameTypes,
        extraCondition
    );

    if ( matrix.evaluateSwitchZ('no-workers', scope) ) {
        out.push({
            priority: PRIORITY_HEADERS,
            action: cspAction(µm.cspNoWorker),
            condition: { resourceTypes: frameTypes, tabIds },
        });
    }

    if ( matrix.evaluateSwitchZ('referrer-spoof', scope) ) {
        out.push({
            priority: PRIORITY_HEADERS,
            action: removeReferrerAction,
            condition: {
                domainType: 'thirdParty',
                resourceTypes: allSubresourceTypes,
                tabIds,
            },
        });
    }

    return out;
};

/******************************************************************************/

// Rules for top-level documents: the scope is the document's own hostname.
// Any hostname which is a source or destination of a rule, or which has a
// switch, can be the nearest relevant ancestor.

const compileMainFrame = function() {
    const matrix = µm.tMatrix;
    const out = [];
    const { hostnames } = getMatrixIndex();

    // The hostname whose verdict is that of all the hostnames for which `hn`
    // is the nearest relevant ancestor: if `hn` is above its own domain
    // (e.g. a public suffix), a subdomain has a different first-party domain.
    const representativeOf = hn => {
        const domain = µm.URI.domainFromHostname(hn);
        return domain !== '' && (hn === domain || hn.endsWith(`.${domain}`))
            ? hn
            : UNMATCHED_LABEL + hn;
    };
    const mustBlock = (hn, type) => {
        const rep = representativeOf(hn);
        return (matrix.evaluateCellZXY(rep, rep, type) & 3) === µm.Matrix.Red;
    };
    const switchOf = (hn, name) =>
        matrix.evaluateSwitchZ(name, representativeOf(hn));

    const verdicts = new Map();
    for ( const hn of hostnames ) {
        verdicts.set(hn, mustBlock(hn, 'doc') ? 1 : 0);
    }
    const redirectAction = blockedRedirectAction();
    emitPrioritizedRules(
        out,
        verdicts,
        (matrix.evaluateCellZXY(UNMATCHED_HOSTNAME, UNMATCHED_HOSTNAME, 'doc') & 3) === µm.Matrix.Red ? 1 : 0,
        blocked => [ blocked ? [ redirectAction, mainFrameTypes ] : [ { type: 'allow' }, mainFrameTypes ] ],
        undefined
    );
    // A redirect rule requires a regex filter.
    for ( const rule of out ) {
        if ( rule.action.type === 'redirect' ) {
            rule.condition.regexFilter = '^.+$';
        }
    }

    const rootBlocks = type =>
        (matrix.evaluateCellZXY(UNMATCHED_HOSTNAME, UNMATCHED_HOSTNAME, type) & 3) === µm.Matrix.Red;
    const rootSwitch = name => matrix.evaluateSwitchZ(name, UNMATCHED_HOSTNAME);

    emitRegionRules(out, hostnames, hn => mustBlock(hn, 'cookie'),
        rootBlocks('cookie'), removeCookieAction, mainFrameTypes);
    emitRegionRules(out, hostnames, hn => mustBlock(hn, 'script'),
        rootBlocks('script'), cspAction(µm.cspNoInlineScript), mainFrameTypes);
    emitRegionRules(out, hostnames, hn => mustBlock(hn, 'css'),
        rootBlocks('css'), cspAction(µm.cspNoInlineStyle), mainFrameTypes);
    emitRegionRules(out, hostnames, hn => switchOf(hn, 'no-workers'),
        rootSwitch('no-workers'), cspAction(µm.cspNoWorker), mainFrameTypes);
    emitRegionRules(out, hostnames, hn => switchOf(hn, 'referrer-spoof'),
        rootSwitch('referrer-spoof'), removeReferrerAction, mainFrameTypes,
        { domainType: 'thirdParty' });

    if ( µm.userSettings.processHyperlinkAuditing ) {
        out.push({
            priority: PRIORITY_PING,
            action: { type: 'block' },
            condition: { resourceTypes: [ 'ping' ] },
        });
    }

    return out;
};

const blockedRedirectAction = function() {
    return {
        type: 'redirect',
        redirect: {
            regexSubstitution: vAPI.getURL('main-blocked.html') + '#\\0',
        },
    };
};

/******************************************************************************/

// The ubiquitous blocklist, as dynamic rules: they survive a browser
// restart, and are rebuilt only when the hosts files are reloaded.

const BLOCKLIST_RULE_ID_BASE = 1;

const setBlocklist = async function(hostnames) {
    const byLabelCount = new Map();
    for ( const hn of hostnames ) {
        if ( isDestination(hn) === false ) { continue; }
        const n = labelCount(hn);
        let list = byLabelCount.get(n);
        if ( list === undefined ) {
            list = [];
            byLabelCount.set(n, list);
        }
        list.push(hn);
    }
    const addRules = [];
    let id = BLOCKLIST_RULE_ID_BASE;
    for ( const [ n, requestDomains ] of byLabelCount ) {
        const priority = n * PRIORITY_PER_LABEL;
        addRules.push({
            id: id++,
            priority,
            action: { type: 'block' },
            condition: { requestDomains, resourceTypes: allSubresourceTypes },
        }, {
            id: id++,
            priority,
            action: blockedRedirectAction(),
            condition: {
                regexFilter: '^.+$',
                requestDomains,
                resourceTypes: mainFrameTypes,
            },
        });
    }
    const current = await dnr.getDynamicRules();
    try {
        await dnr.updateDynamicRules({
            removeRuleIds: current.map(rule => rule.id),
            addRules,
        });
    } catch(reason) {
        console.error('uMatrix: failed to update blocklist rules:', reason);
    }
};

const hasBlocklist = async function() {
    const current = await dnr.getDynamicRules();
    return current.length !== 0;
};

/******************************************************************************/

// Session rules are managed in groups: one group for top-level documents,
// one for each distinct (scope, secure) pair of the tabs.

const groups = new Map();           // key => { scope, secure, tabIds, ruleIds }
const tabToGroup = new Map();       // tabId => key
const dirtyGroups = new Set();
let nextRuleId = FIRST_RULE_ID;
let leftoverRuleIds = [];
let started = false;
let committing;
let mustCommitAgain = false;

const groupKeyFrom = (scope, secure) => `${secure ? 's' : 'i'}${scope}`;

const setTabScope = function(tabId, scope, secure) {
    const key = scope !== '' ? groupKeyFrom(scope, secure) : undefined;
    const before = tabToGroup.get(tabId);
    if ( key === before ) { return; }
    if ( before !== undefined ) {
        const group = groups.get(before);
        group.tabIds.delete(tabId);
        dirtyGroups.add(before);
        tabToGroup.delete(tabId);
    }
    if ( key !== undefined ) {
        let group = groups.get(key);
        if ( group === undefined ) {
            group = { scope, secure, tabIds: new Set(), ruleIds: [] };
            groups.set(key, group);
        }
        group.tabIds.add(tabId);
        dirtyGroups.add(key);
        tabToGroup.set(tabId, key);
    }
    scheduleCommit();
};

const onTabContextChanged = function(tabContext) {
    setTabScope(tabContext.tabId, tabContext.rootHostname, tabContext.secure);
};

const onTabContextRemoved = function(tabId) {
    setTabScope(tabId, '', false);
};

const onMatrixChanged = function() {
    matrixIndex = undefined;
    dirtyGroups.add(MAIN_FRAME_GROUP);
    for ( const key of groups.keys() ) {
        dirtyGroups.add(key);
    }
    scheduleCommit();
};

const scheduleCommit = function() {
    if ( started === false ) { return; }
    if ( committing !== undefined ) {
        mustCommitAgain = true;
        return;
    }
    committing = commit().finally(( ) => {
        committing = undefined;
        if ( mustCommitAgain ) {
            mustCommitAgain = false;
            scheduleCommit();
        }
    });
};

const commit = async function() {
    const removeRuleIds = leftoverRuleIds;
    const addRules = [];
    leftoverRuleIds = [];
    for ( const key of dirtyGroups ) {
        let group = groups.get(key);
        if ( group === undefined ) {
            group = { ruleIds: [] };
            groups.set(key, group);
        }
        removeRuleIds.push(...group.ruleIds);
        group.ruleIds = [];
        if ( key !== MAIN_FRAME_GROUP && group.tabIds.size === 0 ) {
            groups.delete(key);
            continue;
        }
        const rules = key === MAIN_FRAME_GROUP
            ? compileMainFrame()
            : compileScope(group.scope, group.secure, Array.from(group.tabIds));
        for ( const rule of rules ) {
            rule.id = nextRuleId++;
            group.ruleIds.push(rule.id);
            addRules.push(rule);
        }
    }
    dirtyGroups.clear();
    if ( removeRuleIds.length === 0 && addRules.length === 0 ) { return; }
    try {
        await dnr.updateSessionRules({ removeRuleIds, addRules });
    } catch(reason) {
        console.error('uMatrix: failed to update session rules:', reason);
    }
};

// Called once the matrix, the hosts files and the tab contexts are ready.
// Session rules left over from a previous instance of the service worker
// keep being enforced until they are replaced, in the same update, by the
// freshly compiled ones.
const start = async function() {
    const current = await dnr.getSessionRules();
    for ( const rule of current ) {
        if ( rule.id < FIRST_RULE_ID ) { continue; }
        leftoverRuleIds.push(rule.id);
        nextRuleId = Math.max(nextRuleId, rule.id + 1);
    }
    const behindTheScene = µm.tabContextManager.mustLookup(vAPI.noTabId);
    setTabScope(vAPI.noTabId, behindTheScene.rootHostname, false);
    started = true;
    onMatrixChanged();
    await committing;
};

self.addEventListener('matrixRulesetChange', ev => {
    if ( ev.detail !== µm.tMatrix ) { return; }
    onMatrixChanged();
});

/******************************************************************************/

// Whether all changes so far have been compiled into rules.
const isIdle = function() {
    return started && committing === undefined && dirtyGroups.size === 0;
};

return {
    start,
    isIdle,
    setBlocklist,
    hasBlocklist,
    onTabContextChanged,
    onTabContextRemoved,
    refresh: onMatrixChanged,
};

/******************************************************************************/

})();

/******************************************************************************/
