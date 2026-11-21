/*******************************************************************************

    Crossbar - a Chromium browser extension to black/white list requests.
    Copyright (C) 2014-2018 Raymond Hill

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

Crossbar.changeUserSettings = function(name, value) {
    if ( typeof name !== 'string' || name === '' ) {
        return;
    }

    // Do not allow an unknown user setting to be created
    if ( this.userSettings[name] === undefined ) {
        return;
    }

    if ( value === undefined ) {
        return this.userSettings[name];
    }

    // Pre-change
    switch ( name ) {
    
    default:        
        break;
    }

    // Change
    this.userSettings[name] = value;

    // Post-change
    switch ( name ) {
    case 'autoUpdate':
        this.scheduleAssetUpdater(value === true ? 120000 : 0);
        break;
    case 'processHyperlinkAuditing':
        if ( this.dnr !== undefined ) {
            this.dnr.refresh();
        }
        break;
    default:        
        break;
    }

    this.saveUserSettings();
};
