/*******************************************************************************

    Crossbar - a browser extension to black/white list requests.
    Copyright (C) 2014-present Raymond Hill

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

    Home: https://github.com/dmolik/crossbar
*/

/* globals publicSuffixList */

'use strict';

/******************************************************************************/
/******************************************************************************/

// Default handler
//      priviledged

{
// >>>>> start of local scope

const xb = Crossbar;

const onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    case 'getAssetContent':
        xb.assets.get(request.url, {
            dontCache: true,
        }).then(response => {
            callback(response);
        });
        return;

    case 'selectAssets':
        xb.selectAssets(request).then(response => {
            callback(response);
        });
        return;

    default:
        break;
    }

    // Sync
    let response;

    switch ( request.what ) {
    case 'blacklistMatrixCell':
        xb.tMatrix.blacklistCell(
            request.srcHostname,
            request.desHostname,
            request.type
        );
        break;

    case 'forceReloadTab':
        xb.forceReload(request.tabId, request.bypassCache);
        break;

    case 'forceUpdateAssets':
        xb.scheduleAssetUpdater(0);
        xb.assets.updateStart({ delay: 2000 });
        break;

    case 'getCellColors':
        const ruleParts = request.ruleParts;
        const tColors = [];
        const pColors = [];
        for ( let i = 0, n = ruleParts.length; i < n; i += 3 ) {
            tColors.push(xb.tMatrix.evaluateCellZXY(
                ruleParts[i+0],
                ruleParts[i+1],
                ruleParts[i+2]
            ));
            pColors.push(xb.pMatrix.evaluateCellZXY(
                ruleParts[i+0],
                ruleParts[i+1],
                ruleParts[i+2]
            ));
        }
        response = { tColors, pColors };
        break;

    case 'getDomainNames':
        response = request.targets.map(target => {
            if ( typeof target !== 'string' ) { return ''; }
            return target.indexOf('/') !== -1
                ? vAPI.domainFromURI(target) || ''
                : vAPI.domainFromHostname(target) || target;
        });
        break;

    case 'getUserSettings':
        response = {
            userSettings: xb.userSettings,
            matrixSwitches: {
                'https-strict': xb.pMatrix.evaluateSwitch('https-strict', '*') === 1,
                'referrer-spoof': xb.pMatrix.evaluateSwitch('referrer-spoof', '*') === 1,
                'noscript-spoof': xb.pMatrix.evaluateSwitch('noscript-spoof', '*') === 1
            }
        };
        break;

    case 'gotoExtensionURL':
        xb.gotoExtensionURL(request);
        break;

    case 'graylistMatrixCell':
        xb.tMatrix.graylistCell(
            request.srcHostname,
            request.desHostname,
            request.type
        );
        break;

    case 'mustBlock':
        response = xb.mustBlock(
            request.scope,
            request.hostname,
            request.type
        );
        break;

    case 'rulesetRevert':
        xb.tMatrix.copyRuleset(request.entries, xb.pMatrix, true);
        break;

    case 'rulesetPersist':
        if ( xb.pMatrix.copyRuleset(request.entries, xb.tMatrix, true) ) {
            xb.saveMatrix();
        }
        break;

    case 'readRawSettings':
        response = xb.stringFromRawSettings();
        break;

    case 'reloadHostsFiles':
        xb.reloadHostsFiles();
        break;

    case 'reloadRecipeFiles':
        xb.loadRecipes(true);
        break;

    case 'setMatrixSwitch':
        xb.tMatrix.setSwitch(request.switchName, '*', request.state);
        if ( xb.pMatrix.setSwitch(request.switchName, '*', request.state) ) {
            xb.saveMatrix();
        }
        break;

    case 'userSettings':
        if ( request.hasOwnProperty('value') === false ) {
            request.value = undefined;
        }
        response = xb.changeUserSettings(request.name, request.value);
        break;

    case 'whitelistMatrixCell':
        xb.tMatrix.whitelistCell(
            request.srcHostname,
            request.desHostname,
            request.type
        );
        break;

    case 'writeRawSettings':
        xb.rawSettingsFromString(request.content);
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.setup(onMessage);

// <<<<< end of local scope
}

/******************************************************************************/
/******************************************************************************/

// Channel:
//      popupPanel
//      privileged

{
// >>>>> start of local scope

const xb = Crossbar;

const RowSnapshot = function(srcHostname, desHostname, desDomain) {
    this.domain = desDomain;
    this.temporary = xb.tMatrix.evaluateRowZXY(srcHostname, desHostname);
    this.permanent = xb.pMatrix.evaluateRowZXY(srcHostname, desHostname);
    this.counts = RowSnapshot.counts.slice();
    this.totals = RowSnapshot.counts.slice();
};

RowSnapshot.counts = (( ) => {
    const aa = [];
    for ( let i = 0, n = xb.Matrix.columnHeaderIndices.size; i < n; i++ ) {
        aa[i] = 0;
    }
    return aa;
})();

const matrixSnapshotFromPage = function(pageStore, details) {
    const xbuser = xb.userSettings;
    const headerIndices = xb.Matrix.columnHeaderIndices;

    const r = {
        appVersion: vAPI.app.version,
        blockedCount: pageStore.perLoadBlockedRequestCount,
        collapseAllDomains: xbuser.popupCollapseAllDomains,
        collapseBlacklistedDomains: xbuser.popupCollapseBlacklistedDomains,
        diff: [],
        domain: pageStore.pageDomain,
        has3pReferrer: pageStore.has3pReferrer,
        hasMixedContent: pageStore.hasMixedContent,
        hasNoscriptTags: pageStore.hasNoscriptTags,
        hasWebWorkers: pageStore.hasWebWorkers,
        hasHostnameAliases: pageStore.hasHostnameAliases,
        headerIndices: Array.from(headerIndices),
        hostname: pageStore.pageHostname,
        mtxContentModified: pageStore.mtxContentModifiedTime !== details.mtxContentModifiedTime,
        mtxCountModified: pageStore.mtxCountModifiedTime !== details.mtxCountModifiedTime,
        mtxContentModifiedTime: pageStore.mtxContentModifiedTime,
        mtxCountModifiedTime: pageStore.mtxCountModifiedTime,
        pMatrixModified: xb.pMatrix.modifiedTime !== details.pMatrixModifiedTime,
        pMatrixModifiedTime: xb.pMatrix.modifiedTime,
        pSwitches: {},
        rows: {},
        rowCount: 0,
        scope: '*',
        tabId: pageStore.tabId,
        tMatrixModified: xb.tMatrix.modifiedTime !== details.tMatrixModifiedTime,
        tMatrixModifiedTime: xb.tMatrix.modifiedTime,
        tSwitches: {},
        url: pageStore.pageUrl,
        userSettings: {
            colorBlindFriendly: xbuser.colorBlindFriendly,
            displayTextSize: xbuser.displayTextSize,
            noTooltips: xbuser.noTooltips,
            popupScopeLevel: xbuser.popupScopeLevel
        }
    };

    if (
        (typeof details.scope === 'string') &&
        (details.scope === '*' || r.hostname.endsWith(details.scope))
    ) {
        r.scope = details.scope;
    } else if ( xbuser.popupScopeLevel === 'site' ) {
        r.scope = r.hostname;
    } else if ( xbuser.popupScopeLevel === 'domain' ) {
        r.scope = r.domain;
    }

    for ( const switchName of xb.Matrix.switchNames ) {
        r.tSwitches[switchName] = xb.tMatrix.evaluateSwitchZ(switchName, r.scope);
        r.pSwitches[switchName] = xb.pMatrix.evaluateSwitchZ(switchName, r.scope);
    }

    // These rows always exist
    r.rows['*'] = new RowSnapshot(r.scope, '*', '*');
    r.rows['1st-party'] = new RowSnapshot(r.scope, '1st-party', '1st-party');
    r.rowCount += 1;

    const xburi = xb.URI;
    const anyIndex = headerIndices.get('*');

    // Ensure that the current scope is also reported in the matrix. This may
    // not be the case for documents which are fetched without going through
    // our webRequest listener (ex. `file:`).
    if ( pageStore.hostnameTypeCells.has(r.hostname + ' doc') === false ) {
        pageStore.hostnameTypeCells.set(r.hostname + ' doc', new Set([ 0 ]));
    }

    for ( const [ rule, urls ] of pageStore.hostnameTypeCells ) {
        const pos = rule.indexOf(' ');
        let reqHostname = rule.slice(0, pos);
        // rhill 2013-10-23: hostname can be empty if the request is a data url
        // https://github.com/gorhill/httpswitchboard/issues/26
        if ( reqHostname === '' ) {
            reqHostname = r.hostname;
        }
        const reqType = rule.slice(pos + 1);
        const reqDomain = xburi.domainFromHostname(reqHostname) || reqHostname;

        // We want rows of self and ancestors
        let desHostname = reqHostname;
        for (;;) {
            // If row exists, ancestors exist
            if ( r.rows.hasOwnProperty(desHostname) !== false ) { break; }
            r.rows[desHostname] = new RowSnapshot(r.scope, desHostname, reqDomain);
            r.rowCount += 1;
            if ( desHostname === reqDomain ) { break; }
            const pos = desHostname.indexOf('.');
            if ( pos === -1 ) { break; }
            desHostname = desHostname.slice(pos + 1);
        }

        const count = urls.size;
        const typeIndex = headerIndices.get(reqType);
        let row = r.rows[reqHostname];
        row.counts[typeIndex] += count;
        row.counts[anyIndex] += count;
        row = r.rows[reqDomain];
        row.totals[typeIndex] += count;
        row.totals[anyIndex] += count;
        row = r.rows['*'];
        row.totals[typeIndex] += count;
        row.totals[anyIndex] += count;
    }

    r.diff = xb.tMatrix.diff(xb.pMatrix, r.hostname, Object.keys(r.rows));

    return r;
};

const matrixSnapshotFromTabId = function(tabId, details) {
    const pageStore = xb.pageStoreFromTabId(tabId);
    if ( pageStore === null ) { return 'ENOTFOUND'; }
    return matrixSnapshotFromPage(pageStore, details);
};

const matrixSnapshotFromRule = function(rule, details) {
    const xbuser = xb.userSettings;
    const headerIndices = xb.Matrix.columnHeaderIndices;
    const [ srchn, deshn, type ] = rule.trim().split(/\s+/);
    const now = Date.now();

    const r = {
        appVersion: vAPI.app.version,
        blockedCount: 0,
        collapseAllDomains: xbuser.popupCollapseAllDomains,
        collapseBlacklistedDomains: xbuser.popupCollapseBlacklistedDomains,
        diff: [],
        domain: vAPI.domainFromHostname(srchn),
        headerIndices: Array.from(headerIndices),
        hostname: srchn,
        mtxContentModified: false,
        mtxCountModified: false,
        mtxContentModifiedTime: now,
        mtxCountModifiedTime: now,
        pMatrixModified: xb.pMatrix.modifiedTime !== details.pMatrixModifiedTime,
        pMatrixModifiedTime: xb.pMatrix.modifiedTime,
        pSwitches: {},
        rows: {},
        rowCount: 0,
        scope: '*',
        tMatrixModified: xb.tMatrix.modifiedTime !== details.tMatrixModifiedTime,
        tMatrixModifiedTime: xb.tMatrix.modifiedTime,
        tSwitches: {},
        url: `https://${srchn}/`,
        userSettings: {
            colorBlindFriendly: xbuser.colorBlindFriendly,
            displayTextSize: xbuser.displayTextSize,
            noTooltips: xbuser.noTooltips,
            popupScopeLevel: xbuser.popupScopeLevel
        }
    };

    if (
        (typeof details.scope === 'string') &&
        (details.scope === '*' || r.hostname.endsWith(details.scope))
    ) {
        r.scope = details.scope;
    } else if ( xbuser.popupScopeLevel === 'site' ) {
        r.scope = r.hostname;
    } else if ( xbuser.popupScopeLevel === 'domain' ) {
        r.scope = r.domain;
    }

    for ( const switchName of xb.Matrix.switchNames ) {
        r.tSwitches[switchName] = xb.tMatrix.evaluateSwitchZ(switchName, r.scope);
        r.pSwitches[switchName] = xb.pMatrix.evaluateSwitchZ(switchName, r.scope);
    }

    // These rows always exist
    r.rows['*'] = new RowSnapshot(r.scope, '*', '*');
    r.rows['1st-party'] = new RowSnapshot(r.scope, '1st-party', '1st-party');
    r.rowCount += 1;

    const xburi = xb.URI;
    const anyIndex = headerIndices.get('*');

    const hostnameTypeCells = new Map();
    hostnameTypeCells.set(`${srchn} doc`, new Set([ 0 ]));
    hostnameTypeCells.set(`${deshn} ${type}`, new Set([ 1 ]));

    for ( const [ rule, urls ] of hostnameTypeCells ) {
        const pos = rule.indexOf(' ');
        const reqHostname = rule.slice(0, pos);
        const reqType = rule.slice(pos + 1);
        const reqDomain = xburi.domainFromHostname(reqHostname) || reqHostname;

        // We want rows of self and ancestors
        let desHostname = reqHostname;
        for (;;) {
            // If row exists, ancestors exist
            if ( r.rows.hasOwnProperty(desHostname) !== false ) { break; }
            r.rows[desHostname] = new RowSnapshot(r.scope, desHostname, reqDomain);
            r.rowCount += 1;
            if ( desHostname === reqDomain ) { break; }
            const pos = desHostname.indexOf('.');
            if ( pos === -1 ) { break; }
            desHostname = desHostname.slice(pos + 1);
        }

        const count = urls.size;
        const typeIndex = headerIndices.get(reqType);
        let row = r.rows[reqHostname];
        row.counts[typeIndex] += count;
        row.counts[anyIndex] += count;
        row = r.rows[reqDomain];
        row.totals[typeIndex] += count;
        row.totals[anyIndex] += count;
        row = r.rows['*'];
        row.totals[typeIndex] += count;
        row.totals[anyIndex] += count;
    }

    r.diff = xb.tMatrix.diff(xb.pMatrix, r.hostname, Object.keys(r.rows));

    return r;
};

const matrixSnapshotFromAny = async function(sender, details) {
    // Specific tab id?
    if ( typeof details.tabId === 'number' && details.tabId !== 0 ) {
        const pageStore = xb.pageStoreFromTabId(details.tabId);
        if ( pageStore === null ) { return 'ENOTFOUND'; }
        if (
            xb.tMatrix.modifiedTime === details.tMatrixModifiedTime &&
            xb.pMatrix.modifiedTime === details.pMatrixModifiedTime &&
            pageStore.mtxContentModifiedTime === details.mtxContentModifiedTime &&
            pageStore.mtxCountModifiedTime === details.mtxCountModifiedTime
        ) {
            return 'ENOCHANGE';
        }
        return matrixSnapshotFromPage(pageStore, details);
    }

    // Target encoded in URL?
    if ( typeof sender.url === 'string' ) {
        const url = new URL(sender.url);
        const params = url.searchParams;
        if ( params.has('tabid') ) {
            const tabId = parseInt(params.get('tabid'), 10);
            if ( isNaN(tabId) === false ) {
                return matrixSnapshotFromTabId(tabId, details);
            }
        }
        if ( params.has('rule') ) {
            return matrixSnapshotFromRule(params.get('rule'), details);
        }
    }

    // Fall back to currently active tab
    const tab = await vAPI.tabs.getCurrent();
    return tab instanceof Object !== false
        ? matrixSnapshotFromTabId(tab.id, details)
        : 'ENOTFOUND';
};

/******************************************************************************/

const onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    case 'fetchRecipes':
        xb.recipeManager.fetch(
            request.srcHostname,
            request.desHostnames,
            callback
        );
        return;

    case 'matrixSnapshot':
        matrixSnapshotFromAny(sender, request).then(response => {
            callback(response);
        });
        return;

    default:
        break;
    }

    // Sync
    let response;

    switch ( request.what ) {
    case 'applyRecipe':
        xb.recipeManager.apply(request);
        break;

    case 'fetchRecipeCommitStatuses':
        response = xb.recipeManager.statuses(request);
        break;

    case 'toggleMatrixSwitch':
        xb.tMatrix.setSwitchZ(
            request.switchName,
            request.srcHostname,
            xb.tMatrix.evaluateSwitchZ(request.switchName, request.srcHostname) === false
        );
        break;

    case 'applyDiffToPermanentMatrix': // aka "persist"
        if ( xb.pMatrix.applyDiff(request.diff, xb.tMatrix) ) {
            xb.saveMatrix();
        }
        break;

    case 'applyDiffToTemporaryMatrix': // aka "revert"
        xb.tMatrix.applyDiff(request.diff, xb.pMatrix);
        break;

    case 'revertTemporaryMatrix':
        xb.tMatrix.assign(xb.pMatrix);
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen({
    name: 'popup.js',
    listener: onMessage,
    privileged: true,
});

// <<<<< end of local scope
}

/******************************************************************************/
/******************************************************************************/

// Channel:
//      contentscript
//      unprivileged

{
// >>>>> start of local scope

const xb = Crossbar;

/******************************************************************************/

const foundInlineCode = function(tabId, pageStore, details, type) {
    if ( pageStore === null ) { return; }

    const srcHn = pageStore.pageHostname;
    const docOrigin = xb.URI.originFromURI(details.documentURI);
    const desHn = vAPI.hostnameFromURI(docOrigin);

    let blocked = details.blocked;
    if ( blocked === undefined ) {
        blocked = xb.mustBlock(srcHn, desHn, type);
    }

    const mapTo = {
        css: 'style',
        script: 'script'
    };

    // https://github.com/gorhill/httpswitchboard/issues/333
    //   Look-up here whether inline scripting is blocked for the frame.
    const desURL = `${docOrigin}/{inline_${mapTo[type]}}`;
    pageStore.recordRequest(type, desURL, blocked);
    if ( xb.logger.enabled ) {
        xb.filteringContext.duplicate()
          .fromTabId(tabId)
          .setRealm('network')
          .setURL(desURL)
          .setType(type)
          .setFilter(blocked)
          .toLogger();
    }
};

/******************************************************************************/

const contentScriptLocalStorageHandler = function(tabId, originURL) {
    const tabContext = xb.tabContextManager.lookup(tabId);
    if ( tabContext === null ) { return; }

    const srcHn = tabContext.rootHostname;
    const desHn = vAPI.hostnameFromURI(originURL);
    const blocked = xb.mustBlock(srcHn, desHn, 'cookie');

    const pageStore = xb.pageStoreFromTabId(tabId);
    if ( pageStore !== null ) {
        const desURL = `${originURL}/{localStorage}`;
        pageStore.recordRequest('cookie', desURL, blocked);
        if ( xb.logger.enabled ) {
            xb.filteringContext.duplicate()
              .fromTabId(tabId)
              .setRealm('network')
              .setURL(desURL)
              .setType('cookie')
              .setFilter(blocked)
              .toLogger();
        }
    }

    const removeStorage = blocked && xb.userSettings.deleteLocalStorage;
    if ( removeStorage ) {
        xb.localStorageRemovedCounter++;
    }

    return removeStorage;
};

/******************************************************************************/

// Evaluate many URLs against the matrix.

const lookupBlockedCollapsibles = function(tabId, requests) {
    if ( placeholdersReadTime < xb.rawSettingsWriteTime ) {
        placeholders = undefined;
    }

    if ( placeholders === undefined ) {
        placeholders = {
            frame: xb.rawSettings.framePlaceholder,
            image: xb.rawSettings.imagePlaceholder
        };
        if ( placeholders.frame ) {
            placeholders.frameDocument =
                xb.rawSettings.framePlaceholderDocument.replace(
                    '{{bg}}',
                    xb.rawSettings.framePlaceholderBackground !== 'default' ?
                        xb.rawSettings.framePlaceholderBackground :
                        xb.rawSettings.placeholderBackground
                );
        }
        if ( placeholders.image ) {
            placeholders.imageBorder =
                xb.rawSettings.imagePlaceholderBorder !== 'default' ?
                    xb.rawSettings.imagePlaceholderBorder :
                    xb.rawSettings.placeholderBorder;
            placeholders.imageBackground =
                xb.rawSettings.imagePlaceholderBackground !== 'default' ?
                    xb.rawSettings.imagePlaceholderBackground :
                    xb.rawSettings.placeholderBackground;
        }
        placeholdersReadTime = Date.now();
    }

    var response = {
        blockedResources: [],
        hash: requests.hash,
        id: requests.id,
        placeholders: placeholders
    };

    var tabContext = xb.tabContextManager.lookup(tabId);
    if ( tabContext === null ) {
        return response;
    }

    var pageStore = xb.pageStoreFromTabId(tabId);
    if ( pageStore !== null ) {
        pageStore.lookupBlockedCollapsibles(requests, response);
    }

    return response;
};

var placeholders,
    placeholdersReadTime = 0;

/******************************************************************************/

const onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    default:
        break;
    }

    let tabId = sender && sender.tab ? sender.tab.id || 0 : 0,
        tabContext = xb.tabContextManager.lookup(tabId),
        srcHn = tabContext && tabContext.rootHostname,
        pageStore = xb.pageStoreFromTabId(tabId);

    // Sync
    let response;

    switch ( request.what ) {
    case 'contentScriptHasLocalStorage':
        response = contentScriptLocalStorageHandler(tabId, request.originURL);
        break;

    case 'lookupBlockedCollapsibles':
        response = lookupBlockedCollapsibles(tabId, request);
        break;

    case 'mustRenderNoscriptTags?':
        if ( tabContext === null ) { break; }
        response =
            xb.tMatrix.mustBlock(srcHn, srcHn, 'script') &&
            xb.tMatrix.evaluateSwitchZ('noscript-spoof', srcHn);
        if ( pageStore !== null ) {
            pageStore.hasNoscriptTags = true;
        }
        break;

    case 'securityPolicyViolation':
        if ( request.directive === 'worker-src' ) {
            let desURL = request.blockedURI;
            let desHn = xb.URI.hostnameFromURI(desURL);
            if ( desHn === '' ) {
                desURL = request.documentURI;
                desHn = xb.URI.hostnameFromURI(desURL);
            }
            if ( pageStore !== null ) {
                pageStore.hasWebWorkers = true;
                pageStore.recordRequest('script', desURL, request.blocked);
            }
            if ( tabContext !== null && xb.logger.enabled ) {
                xb.filteringContext.duplicate()
                  .fromTabId(tabId)
                  .setRealm('network')
                  .setURL(desURL)
                  .setType('worker')
                  .setFilter(request.blocked)
                  .toLogger();
            }
        } else if ( request.directive === 'script-src' ) {
            foundInlineCode(tabId, pageStore, request, 'script');
        } else if ( request.directive === 'style-src' ) {
            foundInlineCode(tabId, pageStore, request, 'css');
        }
        break;

    case 'shutdown?':
        if ( tabContext !== null ) {
            response = xb.tMatrix.evaluateSwitchZ('matrix-off', srcHn);
        }
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen({
    name: 'contentscript.js',
    listener: onMessage,
});

// <<<<< end of local scope
}

/******************************************************************************/
/******************************************************************************/

// Channel:
//      cloudWidget
//      privileged

{
// >>>>> start of local scope

const xb = Crossbar;

const onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    case 'cloudGetOptions':
        vAPI.cloud.getOptions(function(options) {
            options.enabled = xb.userSettings.cloudStorageEnabled === true;
            callback(options);
        });
        return;

    case 'cloudSetOptions':
        vAPI.cloud.setOptions(request.options, callback);
        return;

    case 'cloudPull':
        return vAPI.cloud.pull(request.datakey, callback);

    case 'cloudPush':
        return vAPI.cloud.push(request.datakey, request.data, callback);

    default:
        break;
    }

    // Sync
    var response;

    switch ( request.what ) {
    // For when cloud storage is disabled.
    case 'cloudPull':
        // fallthrough
    case 'cloudPush':
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen({
    name: 'cloud-ui.js',
    listener: onMessage,
    privileged: true,
});

// <<<<< end of local scope
}

/******************************************************************************/
/******************************************************************************/

// Channel:
//      dashboard
//      privileged

{
// >>>>> start of local scope

const xb = Crossbar;

const modifyRuleset = function(details) {
    let ruleset = details.permanent ? xb.pMatrix : xb.tMatrix,
        modifiedTime = ruleset.modifiedTime;
    let toRemove = new Set(details.toRemove.trim().split(/\s*[\n\r]+\s*/));
    for ( let rule of toRemove ) {
        ruleset.removeFromLine(rule);
    }
    let toAdd = new Set(details.toAdd.trim().split(/\s*[\n\r]+\s*/));
    for ( let rule of toAdd ) {
        ruleset.addFromLine(rule);
    }
    if ( details.permanent && ruleset.modifiedTime !== modifiedTime ) {
        xb.saveMatrix();
    }
};

const getAssets = function() {
    return Promise.all([
        xb.getAvailableHostsFiles(),
        xb.getAvailableRecipeFiles(),
        xb.assets.metadata(),
    ]).then(results => {
        return {
            autoUpdate: xb.userSettings.autoUpdate,
            blockedHostnameCount: xb.ubiquitousBlacklistRef.addedCount,
            hosts: Array.from(results[0]),
            recipes: Array.from(results[1]),
            userRecipes: xb.userSettings.userRecipes,
            cache: results[2],
            contributor: xb.rawSettings.contributorMode
        };
    });
};

const restoreUserData = async function(userData) {
    await Promise.all([
        Crossbar.cacheStorage.clear(),
        vAPI.storage.clear(),
    ]);

    const promises = [
        vAPI.storage.set(userData.settings)
    ];
    const bin = { userMatrix: userData.rules };
    if ( userData.hostsFiles instanceof Object ) {
        bin.liveHostsFiles = userData.hostsFiles;
    }
    promises.push(vAPI.storage.set(bin));
    if ( userData.rawSettings instanceof Object ) {
        promises.push(Crossbar.saveRawSettings(userData.rawSettings));
    }
    await Promise.all(promises);

    vAPI.app.restart();
};

const resetUserData = async function() {
    await Promise.all([
        Crossbar.cacheStorage.clear(),
        vAPI.storage.clear(),
    ]);

    vAPI.app.restart();
};

/******************************************************************************/

const onMessage = function(request, sender, callback) {

    // Async
    switch ( request.what ) {
    case 'getAssets':
        getAssets().then(response => {
            callback(response);
        });
        return;

    case 'getSomeStats':
        xb.getBytesInUse().then(bytesInUse => {
            callback({
                version: vAPI.app.version,
                storageUsed: bytesInUse,
            });
        });
        return;

    default:
        break;
    }

    // Sync
    let response;

    switch ( request.what ) {
    case 'getAllUserData':
        response = {
            app: vAPI.app.name,
            version: vAPI.app.version,
            when: Date.now(),
            settings: xb.userSettings,
            rules: xb.pMatrix.toArray().sort(),
            rawSettings: xb.rawSettings
        };
        break;

    case 'modifyRuleset':
        modifyRuleset(request);
        /* falls through */

    case 'getRuleset':
        response = {
            temporaryRules: xb.tMatrix.toArray(),
            permanentRules: xb.pMatrix.toArray()
        };
        break;

    case 'purgeCache':
        xb.assets.purge(request.assetKey);
        xb.assets.remove('compiled/' + request.assetKey);
        break;

    case 'purgeAllCaches':
        if ( request.hard ) {
            xb.assets.remove(/./);
        } else {
            xb.assets.purge(/./, 'public_suffix_list.dat');
        }
        break;

    case 'resetAllUserData':
        resetUserData();
        break;

    case 'restoreAllUserData':
        restoreUserData(request.userData);
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen({
    name: 'dashboard',
    listener: onMessage,
    privileged: true,
});

// <<<<< end of local scope
}

/******************************************************************************/
/******************************************************************************/

// Channel:
//      loggerUI
//      privileged

{
// >>>>> start of local scope

/******************************************************************************/

const xb = Crossbar;
const extensionOriginURL = vAPI.getURL('');

const getLoggerData = async function(details, activeTabId) {
    const response = {
        activeTabId,
        colorBlind: xb.userSettings.colorBlindFriendly,
        entries: xb.logger.readAll(details.ownerId),
        pageStoresToken: xb.pageStoresToken
    };
    if ( xb.pageStoresToken !== details.pageStoresToken ) {
        const pageStores = new Map();
        for ( const [ tabId, pageStore ] of xb.pageStores ) {
            if ( pageStore.rawURL.startsWith(extensionOriginURL) ) { continue; }
            let title = pageStore.title;
            if ( title === '' ) {
                title = pageStore.rawURL;
            }
            pageStores.set(tabId, title);
        }
        response.pageStores = Array.from(pageStores);
    }
    if ( activeTabId ) {
        const pageStore = xb.pageStoreFromTabId(activeTabId);
        if (
            pageStore === null ||
            pageStore.rawURL.startsWith(extensionOriginURL)
        ) {
            response.activeTabId = undefined;
        }
    }
    if ( details.popupLoggerBoxChanged && vAPI.windows instanceof Object ) {
        const tabs = await vAPI.tabs.query({
            url: vAPI.getURL('/logger-ui.html?popup=1')
        });
        if ( tabs.length !== 0 ) {
            const win = await vAPI.windows.get(tabs[0].windowId);
            if ( win ) {
                vAPI.localStorage.setItem('popupLoggerBox', JSON.stringify({
                    left: win.left,
                    top: win.top,
                    width: win.width,
                    height: win.height,
                }));
            }
        }
    }
    return response;
};

/******************************************************************************/

const onMessage = function(request, sender, callback) {
    // Async
    switch ( request.what ) {
    case 'readAll':
        if (
            xb.logger.ownerId !== undefined &&
            xb.logger.ownerId !== request.ownerId
        ) {
            return callback({ unavailable: true });
        }
        vAPI.tabs.getCurrent().then(tab => {
            return getLoggerData(request, tab && tab.id);
        }).then(response => {
            callback(response);
        });
        return;

    default:
        break;
    }

    // Sync
    let response;

    switch ( request.what ) {
    case 'getPublicSuffixListData':
        response = publicSuffixList.toSelfie();
        break;

    case 'getRuleEditorOptions':
        response = {
            colorBlindFriendly: xb.userSettings.colorBlindFriendly,
            popupScopeLevel: xb.userSettings.popupScopeLevel
        };
        break;

    case 'releaseView':
        if ( request.ownerId === xb.logger.ownerId ) {
            xb.logger.ownerId = undefined;
        }
        break;

    default:
        return vAPI.messaging.UNHANDLED;
    }

    callback(response);
};

vAPI.messaging.listen({
    name: 'loggerUI',
    listener: onMessage,
    privileged: true,
});

// <<<<< end of local scope
}

/******************************************************************************/
/******************************************************************************/
