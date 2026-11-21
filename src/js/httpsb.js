/*******************************************************************************

    Crossbar - a Chromium browser extension to black/white list requests.
    Copyright (C) 2014-2016 Raymond Hill

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

'use strict';

/******************************************************************************/

{
    const xb = Crossbar;
    xb.pMatrix = new xb.Matrix();
    xb.pMatrix.setSwitch('matrix-off', 'about-scheme', 1);
    xb.pMatrix.setSwitch('matrix-off', 'chrome-extension-scheme', 1);
    xb.pMatrix.setSwitch('matrix-off', 'chrome-scheme', 1);
    xb.pMatrix.setSwitch('matrix-off', 'moz-extension-scheme', 1);
    xb.pMatrix.setSwitch('matrix-off', 'opera-scheme', 1);
    xb.pMatrix.setSwitch('matrix-off', 'vivaldi-scheme', 1);
    // https://discourse.mozilla.org/t/support-umatrix/5131/157
    xb.pMatrix.setSwitch('matrix-off', 'wyciwyg-scheme', 1);
    xb.pMatrix.setSwitch('matrix-off', 'behind-the-scene', 1);
    xb.pMatrix.setSwitch('referrer-spoof', 'behind-the-scene', 2);
    xb.pMatrix.setSwitch('https-strict', 'behind-the-scene', 2);
    // Global rules
    xb.pMatrix.setSwitch('referrer-spoof', '*', 1);
    xb.pMatrix.setSwitch('noscript-spoof', '*', 1);
    xb.pMatrix.setSwitch('cname-reveal', '*', 1);
    xb.pMatrix.setCell('*', '*', '*', xb.Matrix.Red);
    xb.pMatrix.setCell('*', '*', 'css', xb.Matrix.Green);
    xb.pMatrix.setCell('*', '*', 'image', xb.Matrix.Green);
    xb.pMatrix.setCell('*', '*', 'frame', xb.Matrix.Red);
    // 1st-party rules
    xb.pMatrix.setCell('*', '1st-party', '*', xb.Matrix.Green);
    xb.pMatrix.setCell('*', '1st-party', 'frame', xb.Matrix.Green);

    xb.tMatrix = new xb.Matrix();
    xb.tMatrix.assign(xb.pMatrix);
}

/******************************************************************************/

Crossbar.hostnameFromURL = function(url) {
    var hn = this.URI.hostnameFromURI(url);
    return hn === '' ? '*' : hn;
};

/******************************************************************************/

Crossbar.mustBlock = function(srcHostname, desHostname, type) {
    return this.tMatrix.mustBlock(srcHostname, desHostname, type);
};

Crossbar.mustAllow = function(srcHostname, desHostname, type) {
    return this.mustBlock(srcHostname, desHostname, type) === false;
};

/******************************************************************************/

Crossbar.formatCount = function(count) {
    if ( typeof count !== 'number' ) {
        return '';
    }
    var s = count.toFixed(0);
    if ( count >= 1000 ) {
        if ( count < 10000 ) {
            s = '>' + s.slice(0,1) + 'K';
        } else if ( count < 100000 ) {
            s = s.slice(0,2) + 'K';
        } else if ( count < 1000000 ) {
            s = s.slice(0,3) + 'K';
        } else if ( count < 10000000 ) {
            s = s.slice(0,1) + 'M';
        } else {
            s = s.slice(0,-6) + 'M';
        }
    }
    return s;
};

