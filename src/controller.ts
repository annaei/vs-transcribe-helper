// The MIT License (MIT)
// 
// vs-media-player (https://github.com/mkloubert/vs-media-player)
// Copyright (c) Marcel Joachim Kloubert <marcel.kloubert@gmx.net>
// 
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to
// deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
// sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// 
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
// 
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
// FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
// DEALINGS IN THE SOFTWARE.

import * as Enumerable from 'node-enumerable';
import * as Events from 'events';
import * as HTTP from 'http';
import * as HTTPs from 'https';
import * as Moment from 'moment';
import * as mplayer_contracts from './contracts';
import * as mplayer_helpers from './helpers';
import * as mplayer_players_controls from './players/controls';
import * as mplayer_players_helpers from './players/helpers';
import * as mplayer_players_vlcplayer from './players/vlcplayer';
import * as mplayer_workspace from './workspace';
import * as URL from 'url';
import * as vscode from 'vscode';
import * as Workflows from 'node-workflows';


interface DeviceQuickPickItem extends vscode.QuickPickItem {
    readonly device: mplayer_contracts.Device;
}

interface PlayerConfigQuickPickItem extends vscode.QuickPickItem {
    readonly config: mplayer_contracts.PlayerConfig;
}

interface PlayerQuickPickItem extends vscode.QuickPickItem {
    readonly player: mplayer_contracts.MediaPlayer;
}

interface PlaylistQuickPickItem extends vscode.QuickPickItem {
    readonly playlist: mplayer_contracts.Playlist;
}

interface StatusBarControlsQuickPickItem extends vscode.QuickPickItem {
    readonly controls: mplayer_players_controls.StatusBarController;
}

interface TrackQuickPickItem extends vscode.QuickPickItem {
    readonly track: mplayer_contracts.Track;
}


/**
 * The controller class for that extension.
 */
export class MediaPlayerController extends Events.EventEmitter implements vscode.Disposable {
    jumpToTimestamp() {
        const ME = this;
        const CONNECTED_PLAYERS = ME._connectedPlayers.filter(x => x &&
            mplayer_helpers.toBooleanSafe(x.player.isConnected));
        if(CONNECTED_PLAYERS){
            const currentPlayers = CONNECTED_PLAYERS.map<mplayer_contracts.MediaPlayer>((statusBarController)=>{return statusBarController.player;});
            if(currentPlayers.length==1){
                const player = currentPlayers[0];
                const selected = vscode.window.activeTextEditor.selection;
                const selectedText = vscode.window.activeTextEditor.document.getText(selected);
                if(selectedText){
                    const matches = selectedText.match(/[\d\d?:]+\d\d?:\d\d?/g);
                    if(matches && matches.length>0){
                        // Got the timestamp
                        const timestamp = matches[0];
                        // turn it into seconds 
                        const timeArr = timestamp.split(":");
                        var seconds = 0;
                        for(var i = timeArr.length-1, j=0; i>=0; i--, j++){
                            seconds += parseInt(timeArr[i]) * Math.pow(60, j);
                        }
                        //seek to time 
                        player.seek(seconds);                        
                    }
                }
            }
        }
    }

    insertTimestamp() {
        const ME = this;
        const CONNECTED_PLAYERS = ME._connectedPlayers.filter(x => x &&
            mplayer_helpers.toBooleanSafe(x.player.isConnected));
        if(CONNECTED_PLAYERS){
            const currentTimes = CONNECTED_PLAYERS.map<number>((statusBarController)=>{return statusBarController.player.currentTrack.time;});
            if(currentTimes.length==1){
                var seconds = currentTimes[0];
                var timestamp = mplayer_helpers.secondsToTimestamp(seconds);
                const editor = vscode.window.activeTextEditor;
                const position = editor.selection.active;
                const insertEdit = vscode.TextEdit.insert(position, "["+timestamp+"]");
                editor.edit(
                    editBuilder => {editBuilder.insert(position, "["+timestamp+"]")}
                    );
            }
        }
    }
    /**
     * Stores the current configuration.
     */
    protected _config: mplayer_contracts.Configuration;
    /**
     * Stores all connected players.
     */
    protected _connectedPlayers: mplayer_players_controls.StatusBarController[];
    /**
     * Stores the extension context.
     */
    protected readonly _CONTEXT: vscode.ExtensionContext;
    /**
     * Stores the global output channel.
     */
    protected readonly _OUTPUT_CHANNEL: vscode.OutputChannel;
    /**
     * Stores the package file of that extension.
     */
    protected _PACKAGE_FILE: mplayer_contracts.PackageFile;

    /**
     * Initializes a new instance of that class.
     * 
     * @param {vscode.ExtensionContext} context The underlying extension context.
     * @param {vscode.OutputChannel} outputChannel The global output channel to use.
     * @param {mplayer_contracts.PackageFile} pkgFile The package file of that extension.
     */
    constructor(context: vscode.ExtensionContext,
                outputChannel: vscode.OutputChannel,
                pkgFile: mplayer_contracts.PackageFile) {
        super();

        this._CONTEXT = context;
        this._OUTPUT_CHANNEL = outputChannel;
        this._PACKAGE_FILE = pkgFile;
    }

    /**
     * Adds statusbar controls to internal list.
     * 
     * @param controls The controls to add.
     * 
     * @return {boolean} Controls were added or not. 
     */
    protected addStatusBarControls(controls: mplayer_players_controls.StatusBarController): boolean {
        if (controls) {
            // disconnected

            const CONNECTED_PLAYERS = this._connectedPlayers;
            if (CONNECTED_PLAYERS) {
                const PLAYER = controls.player;

                PLAYER.once('disconnected', (err) => {
                    try {
                        let index: number;
                        while ((index = CONNECTED_PLAYERS.indexOf(controls)) > -1) {
                            CONNECTED_PLAYERS.splice(index, 1);

                            mplayer_players_helpers.disposeControlsAndPlayer(controls);
                        }
                    }
                    catch (e) { }
                });

                if (PLAYER.isConnected) {
                    CONNECTED_PLAYERS.push(controls);

                    try {
                        controls.initialize();
                    }
                    catch (e) {
                        this.log(`MediaPlayerController.addStatusBarControls(): ${mplayer_helpers.toStringSafe(e)}`);
                    }

                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Gets the current configuration.
     */
    public get config(): mplayer_contracts.Configuration {
        return this._config || <any>{};
    }

    /**
     * Connects to a player.
     * 
     * @returns {Promise<boolean>} The promise that indicates if operation was successful or not.
     */
    public connect(): Promise<boolean> {
        const ME = this;

        return new Promise<boolean>((resolve, reject) => {
            const COMPLETED = mplayer_helpers.createSimpleCompletedAction(resolve, reject);

            try {
                const CONNECTED_PLAYERS = (ME._connectedPlayers || []).filter(cp => cp);

                const PLAYERS = (ME.getPlayers() || []).filter(p => {
                    return CONNECTED_PLAYERS.map(cp => cp.player.id)
                                            .indexOf(p.__id) < 0;  // only if NOT connected
                });
                if (PLAYERS.length < 1) {
                    vscode.window.showWarningMessage('[vs-media-player] No players found!').then(() => {
                    }, (err) => {
                        ME.log(`MediaPlayerController.connect(2): ${mplayer_helpers.toStringSafe(err)}`);
                    });

                    COMPLETED(null);
                    return;
                }

                const CONNECT_TO = (item: PlayerConfigQuickPickItem) => {
                    if (!item) {
                        COMPLETED(null, null);
                        return;
                    }

                    mplayer_players_helpers.connectTo(item.config, ME.context).then((newController) => {
                        let result = false;

                        if (false !== newController) {
                            if (newController) {
                                ME.addStatusBarControls(newController);
                            }
                            else {
                                vscode.window.showWarningMessage(`[vs-media-player] Player type is NOT supported!`).then(() => {
                                }, (err) => {
                                    ME.log(`MediaPlayerController.connect(4): ${mplayer_helpers.toStringSafe(err)}`);
                                });
                            }
                        }
                        else {
                            vscode.window.showWarningMessage(`[vs-media-player] Player '${item.label}' is NOT connected!`).then(() => {
                            }, (err) => {
                                ME.log(`MediaPlayerController.connect(3): ${mplayer_helpers.toStringSafe(err)}`);
                            });
                        }

                        COMPLETED(null, result);
                    }).catch((err) => {
                        COMPLETED(err);
                    });
                };

                const QUICK_PICKS: PlayerConfigQuickPickItem[] = PLAYERS.map((c, i) => {
                    let label = mplayer_helpers.toStringSafe(c.name).trim();
                    if ('' === label) {
                        label = `Player #${i + 1}`;
                    }

                    const DESCRIPTION = mplayer_helpers.toStringSafe(c.description).trim();
                    
                    return {
                        label: '$(unmute)  ' + label,
                        config: c,
                        description: DESCRIPTION,
                    };
                });

                if (QUICK_PICKS.length > 1) {
                    vscode.window.showQuickPick(QUICK_PICKS, {
                        placeHolder: 'Select the media player to connect to...',
                    }).then((item) => {
                        CONNECT_TO(item);
                    }, (err) => {
                        COMPLETED(err);
                    });
                }
                else {
                    // the one and only
                    CONNECT_TO(QUICK_PICKS[0]);
                }
            }
            catch (e) {
                ME.log(`MediaPlayerController.connect(1): ${mplayer_helpers.toStringSafe(e)}`);

                COMPLETED(e);
            }
        });
    }

    /**
     * Gets the underlying extension context.
     */
    public get context(): vscode.ExtensionContext {
        return this._CONTEXT;
    }

    /**
     * Disconnects to a player.
     * 
     * @returns {Promise<boolean>} The promise that indicates if operation was successful or not.
     */
    public disconnect(): Promise<boolean> {
        const ME = this;
        
        return new Promise<boolean>(async (resolve, reject) => {
            const COMPLETED = mplayer_helpers.createSimpleCompletedAction(resolve, reject);

            try {
                const PLAYERS = (ME._connectedPlayers || []).filter(cp => cp);

                const QUICK_PICKS: StatusBarControlsQuickPickItem[] = PLAYERS.map((c, i) => {
                    let label = '';
                    let description = '';
                    if (c.player && c.player.config) {
                        label = mplayer_helpers.toStringSafe(c.player.config.name).trim();
                        description = mplayer_helpers.toStringSafe(c.player.config.description).trim();
                    }

                    if ('' === label) {
                        label = `Player #${i + 1}`;
                    }

                    return {
                        label: '$(unmute)  ' + label,
                        controls: c,
                        description: description,
                    };
                });

                if (QUICK_PICKS.length < 1) {
                    vscode.window.showWarningMessage('[vs-media-player] No players found!').then(() => {
                    }, (err) => {
                        ME.log(`MediaPlayerController.disconnect(2): ${mplayer_helpers.toStringSafe(err)}`);
                    });

                    COMPLETED(null);
                    return;
                }

                const DISCONNECT_FROM = async (item: StatusBarControlsQuickPickItem) => {
                    if (!item) {
                        COMPLETED(null, false);
                        return;
                    }

                    try {
                        const CONTROLS = item.controls;

                        await mplayer_players_helpers.disconnectFrom(item.controls);

                        ME._connectedPlayers = (ME._connectedPlayers || []).filter(cp => {
                            return cp !== CONTROLS;
                        });

                        COMPLETED(null, true);
                    }
                    catch (e) {
                        COMPLETED(e);
                    }
                };

                if (QUICK_PICKS.length > 1) {
                    vscode.window.showQuickPick(QUICK_PICKS, {
                        placeHolder: 'Select the media player to disconnect from...',
                    }).then(async (item) => {
                        await DISCONNECT_FROM(item);
                    }, (err) => {
                        COMPLETED(err);
                    });
                }
                else {
                    await DISCONNECT_FROM(QUICK_PICKS[0]);
                }
            }
            catch (e) {
                ME.log(`MediaPlayerController.disconnect(1): ${mplayer_helpers.toStringSafe(e)}`);

                COMPLETED(e);
            }
        });
    }

    /** @inheritdoc */
    public dispose() {
        try {
            this.disposeOldPlayers();

            this.removeAllListeners();
        }
        catch (e) {
            console.log(`[ERROR] MediaPlayerController.dispose(): ${mplayer_helpers.toStringSafe(e)}`);
        }
    }

    /**
     * Diposes all current players.
     * 
     * @return {boolean} Players were disposed or not.
     */
    protected disposeOldPlayers(): boolean {
        const OLD_PLAYERS = this._connectedPlayers;
        if (OLD_PLAYERS)
        {
            OLD_PLAYERS.filter(op => op).forEach(op => {
                mplayer_players_helpers.disposeControlsAndPlayer(op);
            });

            this._connectedPlayers = null;
            return true;
        }

        return false;
    }

    /**
     * Executes an action of a connected player.
     * 
     * @returns {Promise<boolean>} The promise that indicates if operation was successful or not.
     */
    public executePlayerAction(): Promise<boolean> {
        const ME = this;

        return new Promise<boolean>(async (resolve, reject) => {
            const COMPLETED = mplayer_helpers.createSimpleCompletedAction(resolve, reject);

            try {
                const PLAYERS = (ME._connectedPlayers || []).filter(cp => cp);

                const QUICK_PICKS: StatusBarControlsQuickPickItem[] = PLAYERS.map((c, i) => {
                    let label = '';
                    let description = '';
                    if (c.player && c.player.config) {
                        label = mplayer_helpers.toStringSafe(c.player.config.name).trim();
                        description = mplayer_helpers.toStringSafe(c.player.config.description).trim();
                    }

                    if ('' === label) {
                        label = `Player #${i + 1}`;
                    }

                    return {
                        label: label,
                        controls: c,
                        description: description,
                    };
                }).filter(i => {
                    return i.controls &&
                           i.controls.player &&
                           i.controls.player.executeAction;
                });

                if (QUICK_PICKS.length < 1) {
                    vscode.window.showWarningMessage('[vs-media-player] No players found!').then(() => {
                    }, (err) => {
                        ME.log(`MediaPlayerController.executePlayerAction(2): ${mplayer_helpers.toStringSafe(err)}`);
                    });

                    COMPLETED(null);
                    return;
                }

                const CONFIGURE = async (item: StatusBarControlsQuickPickItem) => {
                    if (!item) {
                        COMPLETED(null, false);
                        return;
                    }

                    try {
                        COMPLETED(null,
                                  await item.controls.player.executeAction());
                    }
                    catch (e) {
                        COMPLETED(e);
                    }
                };

                if (QUICK_PICKS.length > 1) {
                    vscode.window.showQuickPick(QUICK_PICKS, {
                        placeHolder: 'Select the media player for executing an action...',
                    }).then(async (item) => {
                        await CONFIGURE(item);
                    }, (err) => {
                        COMPLETED(err);
                    });
                }
                else {
                    await CONFIGURE(QUICK_PICKS[0]);
                }
            }
            catch (e) {
                ME.log(`MediaPlayerController.executePlayerAction(1): ${mplayer_helpers.toStringSafe(e)}`);

                COMPLETED(e);
            }
        });
    }

    /**
     * Returns the list of players configurations.
     * 
     * @returns {mplayer_contracts.PlayerConfig[]} The list of configurations.
     */
    public getPlayers(): mplayer_contracts.PlayerConfig[] {
        const CFG = this.config;
        if (CFG) {
            const PLAYERS = CFG.players || [];

            return PLAYERS.filter(x => x);
        }
    }

    /**
     * Gets if the extension is currently active or not.
     */
    public get isActive(): boolean {
        return !mplayer_helpers.isEmptyString(mplayer_workspace.getRootPath());
    }

    /**
     * Loads a message.
     * 
     * @param {any} msg The message to log.
     * 
     * @chainable
     */
    public log(msg: any): this {
        let now = Moment();

        msg = mplayer_helpers.toStringSafe(msg);
        this.outputChannel
            .appendLine(`[${now.format('YYYY-MM-DD HH:mm:ss')}] ${msg}`);

        return this;
    }

    /**
     * Is invoked AFTER extension has been activated.
     */
    public onActivated() {
        this.reloadConfiguration();
    }

    /**
     * Is invoked when extension is going to be deactivated.
     */
    public onDeactivate() {
        this.dispose();
    }

    /**
     * Event after configuration changed.
     */
    public onDidChangeConfiguration() {
        this.reloadConfiguration();
    }

    /**
     * Event after list of workspace folders changed.
     * 
     * @param {vscode.WorkspaceFoldersChangeEvent} e The event arguments.
     */
    public onDidChangeWorkspaceFolders(e: vscode.WorkspaceFoldersChangeEvent) {
        this.reloadConfiguration();
    }

    /**
     * Gets the global output channel.
     */
    public get outputChannel(): vscode.OutputChannel {
        return this._OUTPUT_CHANNEL;
    }

    /**
     * Gets the package file of that extension.
     */
    public get packageFile(): mplayer_contracts.PackageFile {
        return this._PACKAGE_FILE;
    }

    /**
     * Reloads configuration.
     */
    public reloadConfiguration() {
        const ME = this;

        const SHOW_ERROR = (err: any) => {
            vscode.window.showErrorMessage(`Could not (re)load config: ${mplayer_helpers.toStringSafe(err)}`).then(() => {
            }, (e) => {
                ME.log(`MediaPlayerController.reloadConfiguration(1): ${mplayer_helpers.toStringSafe(err)}`);
                ME.log(`MediaPlayerController.reloadConfiguration(2): ${mplayer_helpers.toStringSafe(e)}`);
            });
        };

        try {
            const CFG: mplayer_contracts.Configuration = vscode.workspace.getConfiguration("media.player") ||
                                                         <any>{};

            const WF = Workflows.create();

            // dispose old players
            WF.next(() => {
                ME.disposeOldPlayers();

                ME._connectedPlayers = [];
            });
            
            if (CFG.players) {
                // update player config entries

                let nextPlayerConfigId = -1;

                CFG.players.filter(p => p).forEach(p => {
                    const ID = ++nextPlayerConfigId;

                    WF.next(() => {
                        (<any>p)['__id'] = ID;
                    });

                    if (mplayer_helpers.toBooleanSafe(p.connectOnStartup, true)) {
                        WF.next(async () => {
                            try {
                                const NEW_CONTROLS = await mplayer_players_helpers.connectTo(p, ME.context);
                                if (NEW_CONTROLS) {
                                    ME.addStatusBarControls(NEW_CONTROLS);
                                }
                                else {
                                    //TODO: 
                                }
                            }
                            catch (e) {
                                //TODO: show error message
                            }
                        });
                    }
                });
            }

            WF.start().then(() => {
                ME._config = CFG;
            }).catch((err) => {
                SHOW_ERROR(err);
            });
        }
        catch (e) {
            SHOW_ERROR(e);
        }
    }

    /**
     * Search.
     * 
     * @return {Promise<boolean>} The promise that indicates if operation was successful or not.
     */
    public search(): Promise<boolean> {
        const ME = this;

        return new Promise<boolean>(async (resolve, reject) => {
            const COMPLETED = mplayer_helpers.createSimpleCompletedAction(resolve, reject);

            try {
                const QUICK_PICKS: mplayer_contracts.ActionQuickPickItem[] = [];

                QUICK_PICKS.push({
                    label: '$(triangle-right)  Track',
                    description: '',
                    action: async () => {
                        return await ME.searchTracks();
                    }
                });

                QUICK_PICKS.push({
                    label: '$(list-unordered)  Playlists',
                    description: '',
                    action: async () => {
                        return await ME.searchPlaylists();
                    }
                });

                vscode.window.showQuickPick(QUICK_PICKS, {
                    placeHolder: 'Select the thing, you would like to search...',
                }).then(async (item) => {
                    if (!item) {
                        COMPLETED(null, false);
                        return;
                    }

                    try {
                        COMPLETED(null,
                                  await Promise.resolve( item.action(item.state, item) ));
                    }
                    catch (e) {
                        COMPLETED(e);
                    }
                }, (err) => {
                    COMPLETED(err);
                });
            }
            catch (e) {
                COMPLETED(e);
            }
        });
    }

    /**
     * Search for playlists.
     * 
     * @return {Promise<boolean>} The promise that indicates if operation was successful or not.
     */
    protected searchPlaylists(): Promise<boolean> {
        const ME = this;

        return new Promise<boolean>(async (resolve, reject) => {
            const COMPLETED = mplayer_helpers.createSimpleCompletedAction(resolve, reject);

            try {
                const PLAYERS = (ME._connectedPlayers || []).filter(cp => cp);

                const PLAYER_QUICK_PICKS: StatusBarControlsQuickPickItem[] = PLAYERS.map((c, i) => {
                    let label = '';
                    let description = '';
                    if (c.player && c.player.config) {
                        label = mplayer_helpers.toStringSafe(c.player.config.name).trim();
                        description = mplayer_helpers.toStringSafe(c.player.config.description).trim();
                    }

                    if ('' === label) {
                        label = `Player #${i + 1}`;
                    }

                    return {
                        label: '$(unmute)  ' + label,
                        controls: c,
                        description: description,
                    };
                });

                if (PLAYER_QUICK_PICKS.length < 1) {
                    vscode.window.showWarningMessage('[vs-media-player] No players found!').then(() => {
                    }, (err) => {
                        ME.log(`MediaPlayerController.searchPlaylists(2): ${mplayer_helpers.toStringSafe(err)}`);
                    });

                    COMPLETED(null);
                    return;
                }

                const SEARCH = async (item: StatusBarControlsQuickPickItem) => {
                    if (!item) {
                        COMPLETED(null, false);
                        return;
                    }

                    try {
                        COMPLETED(null,
                                  await mplayer_players_helpers.searchPlaylists(item.controls.player,
                                                                                ME.context));
                    }
                    catch (e) {
                        COMPLETED(e);
                    }
                };

                if (PLAYER_QUICK_PICKS.length > 1) {
                    vscode.window.showQuickPick(PLAYER_QUICK_PICKS, {
                        placeHolder: 'Select the media player for your search...',
                    }).then(async (item) => {
                        await SEARCH(item);
                    }, (err) => {
                        COMPLETED(err);
                    });
                }
                else {
                    // the one and only
                    await SEARCH(PLAYER_QUICK_PICKS[0]);
                }
            }
            catch (e) {
                ME.log(`MediaPlayerController.searchPlaylists(1): ${mplayer_helpers.toStringSafe(e)}`);

                COMPLETED(e);
            }
        });
    }

    /**
     * Search for tracks.
     * 
     * @return {Promise<boolean>} The promise that indicates if operation was successful or not.
     */
    protected searchTracks(): Promise<boolean> {
        const ME = this;

        return new Promise<boolean>(async (resolve, reject) => {
            const COMPLETED = mplayer_helpers.createSimpleCompletedAction(resolve, reject);

            try {
                const PLAYERS = (ME._connectedPlayers || []).filter(cp => cp);

                const PLAYER_QUICK_PICKS: StatusBarControlsQuickPickItem[] = PLAYERS.map((c, i) => {
                    let label = '';
                    let description = '';
                    if (c.player && c.player.config) {
                        label = mplayer_helpers.toStringSafe(c.player.config.name).trim();
                        description = mplayer_helpers.toStringSafe(c.player.config.description).trim();
                    }

                    if ('' === label) {
                        label = `Player #${i + 1}`;
                    }

                    return {
                        label: '$(unmute)  ' + label,
                        controls: c,
                        description: description,
                    };
                });

                if (PLAYER_QUICK_PICKS.length < 1) {
                    vscode.window.showWarningMessage('[vs-media-player] No players found!').then(() => {
                    }, (err) => {
                        ME.log(`MediaPlayerController.searchTracks(2): ${mplayer_helpers.toStringSafe(err)}`);
                    });

                    COMPLETED(null);
                    return;
                }

                const SEARCH = async (item: StatusBarControlsQuickPickItem) => {
                    if (!item) {
                        COMPLETED(null, false);
                        return;
                    }

                    try {
                        COMPLETED(null,
                                  await mplayer_players_helpers.searchTrack(item.controls.player,
                                                                            ME.context));
                    }
                    catch (e) {
                        COMPLETED(e);
                    }
                };

                if (PLAYER_QUICK_PICKS.length > 1) {
                    vscode.window.showQuickPick(PLAYER_QUICK_PICKS, {
                        placeHolder: 'Select the media player for your search...',
                    }).then(async (item) => {
                        await SEARCH(item);
                    }, (err) => {
                        COMPLETED(err);
                    });
                }
                else {
                    // the one and only
                    await SEARCH(PLAYER_QUICK_PICKS[0]);
                }
            }
            catch (e) {
                ME.log(`MediaPlayerController.searchTracks(1): ${mplayer_helpers.toStringSafe(e)}`);

                COMPLETED(e);
            }
        });
    }

    /**
     * Selectes an item of a playlist.
     * 
     * @returns {Promise<any>} The promise.
     */
    public selectItemOfPlaylist(): Promise<any> {
        const ME = this;

        return new Promise<any>((resolve, reject) => {
            const COMPLETED = mplayer_helpers.createSimpleCompletedAction(resolve, reject);

            try {
                const CONNECTED_PLAYERS = ME._connectedPlayers.filter(x => x &&
                                                                      mplayer_helpers.toBooleanSafe(x.player.isConnected));
                if (CONNECTED_PLAYERS.length < 1) {
                    vscode.window.showWarningMessage('[vs-media-player] Please connect to at least one player!').then(() => {
                    }, (err) => {
                        ME.log(`MediaPlayerController.selectItemOfPlaylist(2): ${mplayer_helpers.toStringSafe(err)}`);
                    });

                    COMPLETED(null);
                    return;
                }

                const PLAY_TRACK = (item: TrackQuickPickItem) => {
                    if (!item) {
                        COMPLETED(null, null);
                        return;
                    }

                    item.track.play().then((hasStarted: boolean) => {
                        if (mplayer_helpers.toBooleanSafe(hasStarted)) {
                            COMPLETED(null);
                        }
                        else {
                            vscode.window.showWarningMessage(`[vs-media-player] Track '${item.label}' has NOT been started!`).then(() => {
                            }, (err) => {
                                ME.log(`MediaPlayerController.selectItemOfPlaylist(4): ${mplayer_helpers.toStringSafe(err)}`);
                            });
                        }

                        COMPLETED(null);
                    }, (err) => {
                        COMPLETED(err);
                    });
                };

                const SELECT_TRACK = (item: PlaylistQuickPickItem) => {
                    if (!item) {
                        COMPLETED(null, null);
                        return;
                    }

                    item.playlist.getTracks().then((tracks) => {
                        const TRACK_QUICK_PICKS: TrackQuickPickItem[] = (tracks || []).filter(t => t).map((t, i) => {
                            let label = mplayer_helpers.toStringSafe(t.name).trim();
                            if ('' === label) {
                                label = `Track #${i + 1}`;
                            }

                            const DESCRIPTION = mplayer_helpers.toStringSafe(t.description).trim();

                            return {
                                label: '$(triangle-right)  ' + `[${i + 1}] ${label}`,
                                description: DESCRIPTION,
                                track: t,                                
                            };
                        });

                        if (TRACK_QUICK_PICKS.length > 0) {
                            if (TRACK_QUICK_PICKS.length > 1) {
                                vscode.window.showQuickPick(TRACK_QUICK_PICKS, {
                                    placeHolder: `Select a track from playlist '${item.label}'...`,
                                }).then((item) => {
                                    PLAY_TRACK(item);
                                }, (err) => {
                                    COMPLETED(err);
                                });
                            }
                            else {
                                // the one and only
                                PLAY_TRACK(TRACK_QUICK_PICKS[0]);
                            }
                        }
                        else {
                            const PLAYLIST_NAME = item.label
                                                      .substr(item.label.indexOf(' '))
                                                      .trim();

                            vscode.window.showWarningMessage(`[vs-media-player] Could not find a track in '${PLAYLIST_NAME}'!`).then(() => {
                            }, (err) => {
                                ME.log(`MediaPlayerController.selectItemOfPlaylist(3): ${mplayer_helpers.toStringSafe(err)}`);
                            });

                            COMPLETED(null);
                        }
                    }, (err) => {
                        COMPLETED(err);
                    });
                };

                const SELECT_PLAYLIST = (item: PlayerQuickPickItem) => {
                    if (!item) {
                        COMPLETED(null, null);
                        return;
                    }

                    item.player.getPlaylists().then((playlists) => {
                        const PLAYLIST_QUICK_PICKS: PlaylistQuickPickItem[] = (playlists || []).filter(x => x).map((pl, i) => {
                            let label = mplayer_helpers.toStringSafe(pl.name).trim();
                            if ('' === label) {
                                let id = mplayer_helpers.toStringSafe(pl.id).trim();
                                if ('' === id) {
                                    id = `#${i + 1}`;
                                }

                                label = `Playlist ${id}`;
                            }

                            const DESCRIPTION = mplayer_helpers.toStringSafe(pl.description).trim();
                            
                            return {
                                label: '$(list-unordered)  ' + label,
                                description: DESCRIPTION,
                                playlist: pl,
                            };
                        });

                        if (PLAYLIST_QUICK_PICKS.length > 0) {
                            if (PLAYLIST_QUICK_PICKS.length > 1) {
                                vscode.window.showQuickPick(PLAYLIST_QUICK_PICKS, {
                                    placeHolder: `Select a playlist of player '${item.label}'...`,
                                }).then((item) => {
                                    SELECT_TRACK(item);
                                }, (err) => {
                                    COMPLETED(err);
                                });
                            }
                            else {
                                // the one and only
                                SELECT_TRACK(PLAYLIST_QUICK_PICKS[0]);
                            }
                        }
                        else {
                            const PLAYER_NAME = item.label
                                                    .substr(item.label.indexOf(' '))
                                                    .trim();

                            vscode.window.showWarningMessage(`[vs-media-player] Could not find a playlist in '${PLAYER_NAME}'!`).then(() => {
                            }, (err) => {
                                ME.log(`MediaPlayerController.selectItemOfPlaylist(3): ${mplayer_helpers.toStringSafe(err)}`);
                            });

                            COMPLETED(null);
                        }
                    }, (err) => {
                        COMPLETED(err);
                    });
                };

                const PLAYER_QUICK_PICKS: PlayerQuickPickItem[] = CONNECTED_PLAYERS.map((c, i) => {
                    const PLAYER = c.player;
                    const CFG: mplayer_contracts.PlayerConfig = c.config || <any>{};

                    let label = mplayer_helpers.toStringSafe(CFG.name).trim();
                    if ('' === label) {
                        label = `Player #${i + 1}`;
                    }

                    const DESCRIPTION = mplayer_helpers.toStringSafe(CFG.description).trim();
                    
                    return {
                        label: '$(unmute)  ' + label,
                        description: DESCRIPTION,
                        player: PLAYER,
                    };
                });

                if (PLAYER_QUICK_PICKS.length > 1) {
                    vscode.window.showQuickPick(PLAYER_QUICK_PICKS, {
                        placeHolder: 'Select the media player...',
                    }).then((item) => {
                        SELECT_PLAYLIST(item);
                    }, (err) => {
                        COMPLETED(err);
                    });
                }
                else {
                    // the one and only
                    SELECT_PLAYLIST(PLAYER_QUICK_PICKS[0]);
                }
            }
            catch (e) {
                ME.log(`MediaPlayerController.selectItemOfPlaylist(1): ${mplayer_helpers.toStringSafe(e)}`);

                COMPLETED(e);
            }
        });
    }

    /**
     * Selects an output for a player.
     * 
     * @return {Promise<boolean>} The promise that indicates if operation was successful or not.
     */
    public selectPlayerOutput(): Promise<boolean> {
        const ME = this;

        return new Promise<boolean>(async (resolve, reject) => {
            const COMPLETED = mplayer_helpers.createSimpleCompletedAction(resolve, reject);

            try {
                const PLAYERS = (ME._connectedPlayers || []).filter(cp => cp);

                const PLAYER_QUICK_PICKS: StatusBarControlsQuickPickItem[] = PLAYERS.map((c, i) => {
                    let label = '';
                    let description = '';
                    if (c.player && c.player.config) {
                        label = mplayer_helpers.toStringSafe(c.player.config.name).trim();
                        description = mplayer_helpers.toStringSafe(c.player.config.description).trim();
                    }

                    if ('' === label) {
                        label = `Player #${i + 1}`;
                    }

                    return {
                        label: '$(unmute)  ' + label,
                        controls: c,
                        description: description,
                    };
                });

                if (PLAYER_QUICK_PICKS.length < 1) {
                    vscode.window.showWarningMessage('[vs-media-player] No players found!').then(() => {
                    }, (err) => {
                        ME.log(`MediaPlayerController.selectPlayerOutput(2): ${mplayer_helpers.toStringSafe(err)}`);
                    });

                    COMPLETED(null);
                    return;
                }

                const SELECT_OUTPUT = async (item: DeviceQuickPickItem) => {
                    if (!item) {
                        COMPLETED(null, null);
                        return;
                    }

                    try {
                        const RESULT = mplayer_helpers.toBooleanSafe( await item.device.select(), true );
                        const DEVICE_NAME = Enumerable.from( item.label.split(' ') )
                                                      .skip(2)
                                                      .joinToString(' ');

                        if (RESULT) {
                            vscode.window.showInformationMessage(`[vs-media-player] Changed output to '${DEVICE_NAME}'.`).then(() => {
                            }, (err) => {
                                ME.log(`MediaPlayerController.selectPlayerOutput(4): ${mplayer_helpers.toStringSafe(err)}`);
                            });
                        }
                        else {
                            vscode.window.showWarningMessage(`[vs-media-player] Could not change output to '${DEVICE_NAME}'!`).then(() => {
                            }, (err) => {
                                ME.log(`MediaPlayerController.selectPlayerOutput(5): ${mplayer_helpers.toStringSafe(err)}`);
                            });
                        }

                        COMPLETED(null, RESULT);
                    }
                    catch (e) {
                        COMPLETED(e);
                    }
                };

                const SELECT_DEVICE = async (item: StatusBarControlsQuickPickItem) => {
                    if (!item) {
                        COMPLETED(null, null);
                        return;
                    }

                    try {
                        const DEVICES = await item.controls.player.getDevices();

                        const DEVICE_QUICK_PICKS: DeviceQuickPickItem[] = Enumerable.from( DEVICES.map((d, i) => {
                            let label = mplayer_helpers.toStringSafe(d.name).trim();
                            if ('' === label) {
                                label = `Device ${mplayer_helpers.toStringSafe(d.id)}`;
                            }

                            const DESCRIPTION = '';

                            return {
                                label: '$(megaphone)  ' + label,
                                device: d,
                                description: '',
                                detail: !mplayer_helpers.toBooleanSafe(d.isActive) ? undefined : '(active)',
                            };
                        }) ).orderBy(d => {
                            return !mplayer_helpers.toBooleanSafe(d.device.isActive) ? 0 : 1;
                        }).thenBy((d) => {
                            return mplayer_helpers.normalizeString(d.label);
                        }).toArray();

                        if (DEVICE_QUICK_PICKS.length > 0) {
                            if (DEVICE_QUICK_PICKS.length > 1) {
                                vscode.window.showQuickPick(DEVICE_QUICK_PICKS, {
                                    placeHolder: 'Select the output device...',
                                }).then(async (item) => {
                                    await SELECT_OUTPUT(item);
                                }, (err) => {
                                    COMPLETED(err);
                                });
                            }
                            else {
                                // the one and only
                                await SELECT_OUTPUT(DEVICE_QUICK_PICKS[0]);
                            }
                        }
                        else {
                            vscode.window.showWarningMessage('[vs-media-player] No devices found!').then(() => {
                            }, (err) => {
                                ME.log(`MediaPlayerController.selectPlayerOutput(3): ${mplayer_helpers.toStringSafe(err)}`);
                            });

                            COMPLETED(null, false);
                        }
                    }
                    catch (e) {
                        COMPLETED(e);
                    }
                };

                if (PLAYER_QUICK_PICKS.length > 1) {
                    vscode.window.showQuickPick(PLAYER_QUICK_PICKS, {
                        placeHolder: 'Select the media player to connect to...',
                    }).then(async (item) => {
                        await SELECT_DEVICE(item);
                    }, (err) => {
                        COMPLETED(err);
                    });
                }
                else {
                    // the one and only
                    await SELECT_DEVICE(PLAYER_QUICK_PICKS[0]);
                }
            }
            catch (e) {
                ME.log(`MediaPlayerController.selectPlayerOutput(1): ${mplayer_helpers.toStringSafe(e)}`);

                COMPLETED(e);
            }
        });
    }
}
