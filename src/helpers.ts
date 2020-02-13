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

import * as ChildProcess from 'child_process';
import * as Enumerable from 'node-enumerable';
import * as HTTP from 'http';
import * as Moment from 'moment';
import * as mplayer_workspace from './workspace';
import * as Path from 'path';
import * as vscode from 'vscode';

/**
 * Options for open function.
 */
export interface OpenOptions {
    /**
     * The app (or options) to open.
     */
    app?: string | string[];
    /**
     * The custom working directory.
     */
    cwd?: string;
    /**
     * An optional list of environment variables
     * to submit to the new process.
     */
    env?: any;
    /**
     * Wait until exit or not.
     */
    wait?: boolean;
}

/**
 * A progress context.
 */
export interface ProgressContext<TState> {
    /**
     * Gets or sets the message to display / report.
     */
    message: string;
    /**
     * Gets the state.
     */
    readonly state: TState;
}

/**
 * Describes a simple 'completed' action.
 * 
 * @param {any} err The occurred error.
 * @param {TResult} [result] The result.
 */
export type SimpleCompletedAction<TResult> = (err: any, result?: TResult) => void;


/**
 * Returns a value as array.
 * 
 * @param {T | T[]} val The value.
 * 
 * @return {T[]} The value as array.
 */
export function asArray<T = any>(val: T | T[]): T[] {
    if (!Array.isArray(val)) {
        return [ val ];
    }

    return val;
}

/**
 * Compares two values for a sort operation.
 * 
 * @param {T} x The left value.
 * @param {T} y The right value.
 * 
 * @return {number} The "sort value".
 */
export function compareValues<T>(x: T, y: T): number {
    if (x === y) {
        return 0;
    }

    if (x > y) {
        return 1;
    }

    if (x < y) {
        return -1;
    }

    return 0;
}

/**
 * Compares values by using a selector.
 * 
 * @param {T} x The left value. 
 * @param {T} y The right value.
 * @param {Function} selector The selector.
 * 
 * @return {number} The "sort value".
 */
export function compareValuesBy<T, U>(x: T, y: T,
                                      selector: (t: T) => U): number {
    if (!selector) {
        selector = (t) => <any>t;
    }

    return compareValues<U>(selector(x),
                            selector(y));
}

/**
 * Creates a simple 'completed' callback for a promise.
 * 
 * @param {Function} resolve The 'succeeded' callback.
 * @param {Function} reject The 'error' callback.
 * 
 * @return {SimpleCompletedAction<TResult>} The created action.
 */
export function createSimpleCompletedAction<TResult>(resolve: (value?: TResult | PromiseLike<TResult>) => void,
                                                     reject?: (reason: any) => void): SimpleCompletedAction<TResult> {
    let completedInvoked = false;

    return (err, result?) => {
        if (completedInvoked) {
            return;
        }

        completedInvoked = true;
        
        if (err) {
            if (reject) {
                reject(err);
            }
        }
        else {
            if (resolve) {
                resolve(result);
            }
        }
    };
}

/**
 * Removes duplicate entries from an array.
 * 
 * @param {T[]} arr The input array.
 * 
 * @return {T[]} The filtered array.
 */
export function distinctArray<T>(arr: T[]): T[] {
    if (!arr) {
        return arr;
    }

    return arr.filter((x, i) => {
        return arr.indexOf(x) === i;
    });
}

/**
 * Checks if a search matches.
 * 
 * @param {string|string[]} parts The search parts.
 * @param {string} searchIn The string to search in.
 * 
 * @return {boolean} Does match or not.
 */
export function doesSearchMatch(parts: string | string[], searchIn: string): boolean {
    parts = asArray(parts).map(p => normalizeString(p));
    parts = distinctArray(parts);

    searchIn = normalizeString(searchIn);

    if (parts.length < 1) {
        return true;
    }

    return Enumerable.from(parts).all(p => {
        return searchIn.indexOf(p) > -1;
    });
}

/**
 * Loads the body from a HTTP response.
 * 
 * @param {HTTP.IncomingMessage} resp The response.
 * 
 * @return {Promise<Buffer>} The promise.
 */
export function getHttpBody(resp: HTTP.IncomingMessage): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
        const COMPLETED = createSimpleCompletedAction(resolve, reject);

        if (!resp) {
            COMPLETED(null);
            return;
        }

        let body = Buffer.alloc(0);

        try {
            const APPEND_CHUNK = (chunk: Buffer): boolean => {
                try {
                    if (chunk) {
                        body = Buffer.concat([body, chunk]);
                    }

                    return true;
                }
                catch (e) {
                    COMPLETED(e);
                    return false;
                }
            };

            resp.on('data', (chunk: Buffer) => {
                APPEND_CHUNK(chunk);
            });

            resp.on('end', (chunk: Buffer) => {
                if (APPEND_CHUNK(chunk)) {
                    COMPLETED(null, body);
                }
            });

            resp.on('error', (err) => {
                COMPLETED(err);
            });
        }
        catch (e) {
            COMPLETED(e);
        }
    });
}

/**
 * Checks if the string representation of a value is empty
 * or contains whitespaces only.
 * 
 * @param {any} val The value to check.
 * 
 * @return {boolean} Is empty or not.
 */
export function isEmptyString(val: any): boolean {
    return '' === toStringSafe(val).trim();
}

/**
 * Checks if a value is (null) or (undefined).
 * 
 * @param {any} val The value to check.
 * 
 * @return {boolean} Is (null)/(undefined) or not.
 */
export function isNullOrUndefined(val: any): boolean {
    return null === val ||
           'undefined' === typeof val;
}

/**
 * Logs a message.
 * 
 * @param {any} msg The message to log.
 */
export function log(msg: any) {
    const NOW = Moment();

    msg = toStringSafe(msg);
    console.log(`[vs-media-player :: ${NOW.format('YYYY-MM-DD HH:mm:ss')}] => ${msg}`);
}

/**
 * Normalizes a value as string so that is comparable.
 * 
 * @param {any} val The value to convert.
 * @param {(str: string) => string} [normalizer] The custom normalizer.
 * 
 * @return {string} The normalized value.
 */
export function normalizeString(val: any, normalizer?: (str: string) => string): string {
    if (!normalizer) {
        normalizer = (str) => str.toLowerCase().trim();
    }

    return normalizer(toStringSafe(val));
}

/**
 * Opens a target.
 * 
 * @param {string} target The target to open.
 * @param {OpenOptions} [opts] The custom options to set.
 * 
 * @param {Promise<ChildProcess.ChildProcess>} The promise.
 */
export function open(target: string, opts?: OpenOptions): Promise<ChildProcess.ChildProcess> {
    let me = this;

    if (!opts) {
        opts = {};
    }

    opts.wait = toBooleanSafe(opts.wait, true);
    
    return new Promise((resolve, reject) => {
        let completed = (err?: any, cp?: ChildProcess.ChildProcess) => {
            if (err) {
                reject(err);
            }
            else {
                resolve(cp);
            }
        };
        
        try {
            if (typeof target !== 'string') {
                throw new Error('Expected a `target`');
            }

            let cmd: string;
            let appArgs: string[] = [];
            let args: string[] = [];
            let cpOpts: ChildProcess.SpawnOptions = {
                cwd: opts.cwd || mplayer_workspace.getRootPath(),
                env: opts.env,
            };

            if (Array.isArray(opts.app)) {
                appArgs = opts.app.slice(1);
                opts.app = opts.app[0];
            }

            if (process.platform === 'darwin') {
                // Apple

                cmd = 'open';

                if (opts.wait) {
                    args.push('-W');
                }

                if (opts.app) {
                    args.push('-a', opts.app);
                }
            }
            else if (process.platform === 'win32') {
                // Microsoft

                cmd = 'cmd';
                args.push('/c', 'start', '""');
                target = target.replace(/&/g, '^&');

                if (opts.wait) {
                    args.push('/wait');
                }

                if (opts.app) {
                    args.push(opts.app);
                }

                if (appArgs.length > 0) {
                    args = args.concat(appArgs);
                }
            }
            else {
                // Unix / Linux

                if (opts.app) {
                    cmd = opts.app;
                } else {
                    cmd = Path.join(__dirname, 'xdg-open');
                }

                if (appArgs.length > 0) {
                    args = args.concat(appArgs);
                }

                if (!opts.wait) {
                    // xdg-open will block the process unless
                    // stdio is ignored even if it's unref'd
                    cpOpts.stdio = 'ignore';
                }
            }

            args.push(target);

            if (process.platform === 'darwin' && appArgs.length > 0) {
                args.push('--args');
                args = args.concat(appArgs);
            }

            let cp = ChildProcess.spawn(cmd, args, cpOpts);

            if (opts.wait) {
                cp.once('error', (err) => {
                    completed(err);
                });

                cp.once('close', function (code) {
                    if (code > 0) {
                        completed(new Error('Exited with code ' + code));
                        return;
                    }

                    completed(null, cp);
                });
            }
            else {
                cp.unref();

                completed(null, cp);
            }
        }
        catch (e) {
            completed(e);
        }
    });
}

/**
 * Extracts the query parameters of an URI to an object.
 * 
 * @param {string} query The query string.
 * 
 * @return {Object} The parameters of the URI as object.
 */
export function queryParamsToObject(query: string): { [name: string]: string } {
    query = toStringSafe(query);

    let params: any;

    if (!isEmptyString(query)) {
        // s. https://css-tricks.com/snippets/jquery/get-query-params-object/
        params = query.replace(/(^\?)/,'')
                      .split("&")
                      .map(function(n) { return n = n.split("="), this[normalizeString(n[0])] =
                                                                       toStringSafe(decodeURIComponent(n[1])), this}
                      .bind({}))[0];
    }

    if (isNullOrUndefined(params)) {
        params = {};
    }

    return params;
}

/**
 * Registers a safe HTTP request error handler for a promise completed action.
 * 
 * @param {HTTP.ClientRequest} req The request.
 * @param {SimpleCompletedAction<TResult>} [completedAction] The completed action.
 */
export function registerSafeHttpRequestErrorHandlerForCompletedAction<TResult>(req: HTTP.ClientRequest,
                                                                               completedAction?: SimpleCompletedAction<TResult>) {
    if (req) {
        req.on('error', (err) => {
            if (completedAction) {
                completedAction(err);
            }  
        });
    }
}

/**
 * Replaces all occurrences of a string.
 * 
 * @param {any} str The input string.
 * @param {any} searchValue The value to search for.
 * @param {any} replaceValue The value to replace 'searchValue' with.
 * 
 * @return {string} The output string.
 */
export function replaceAllStrings(str: any, searchValue: any, replaceValue: any): string {
    str = toStringSafe(str);
    searchValue = toStringSafe(searchValue);
    replaceValue = toStringSafe(replaceValue);

    return str.split(searchValue)
              .join(replaceValue);
}

/**
 * Converts a value to a boolean.
 * 
 * @param {any} val The value to convert.
 * @param {any} defaultValue The value to return if 'val' is (null) or (undefined).
 * 
 * @return {boolean} The converted value.
 */
export function toBooleanSafe(val: any, defaultValue: any = false): boolean {
    if (isNullOrUndefined(val)) {
        return defaultValue;
    }

    return !!val;
}

/**
 * Converts a value to a string that is NOT (null) or (undefined).
 * 
 * @param {any} val The input value.
 * @param {any} [defValue] The default value.
 * 
 * @return {string} The output value.
 */
export function toStringSafe(val: any, defValue: any = ''): string {
    if (isNullOrUndefined(val)) {
        return defValue;
    }

    return '' + val;
}

/**
 * Tries to dispose an object.
 * 
 * @param {Object} obj The object to dispose.
 * 
 * @return {boolean} Operation was successful or not.
 */
export function tryDispose(obj: { dispose?: () => any }): boolean {
    try {
        if (obj && obj.dispose) {
            obj.dispose();
        }

        return true;
    }
    catch (e) {
        log(`[ERROR] helpers.tryDispose(): ${toStringSafe(e)}`)

        return false;
    }
}

/**
 * Executes a task by using a progress message.
 * 
 * @param {(ctx: ProgressContext<TState>) => TResult} task The task to execute.
 * @param {vscode.ProgressOptions} options The options.
 * @param {TState} [state] The optional state.
 * 
 * @returns {Promise<TResult>} The promise with the result.
 */
export function withProgress<TResult = void, TState = undefined>(task: (ctx: ProgressContext<TState>) => TResult,
                                                                 options?: vscode.ProgressOptions,
                                                                 state?: TState): Promise<TResult> {
    if (!options) {
        options = {
            location: vscode.ProgressLocation.Window,
        };
    }
    
    if (!task) {
        task = <any>(() => {});
    }
    
    return new Promise<TResult>((resolve, reject) => {
        const COMPLETED = createSimpleCompletedAction(resolve, reject);

        vscode.window.withProgress(options, (prog) => {
            const CONTEXT: ProgressContext<TState> = {
                message: undefined,
                state: state,
            };

            // CONTEXT.message
            let currentMessage: string;
            Object.defineProperty(CONTEXT, 'message', {
                enumerable: true,

                get: () => {
                    return currentMessage;
                },
                set: (newValue) => {
                    try {
                        prog.report({
                            message: currentMessage = toStringSafe(newValue),
                        });
                    }
                    catch (e) {
                        log(`[ERROR] helpers.withProgress(): ${toStringSafe(e)}`);
                    }
                }
            });

            return Promise.resolve(
                task(CONTEXT),
            );
        }).then((result) => {
            COMPLETED(null, result);
        }, (err) => {
            COMPLETED(err);
        });
    });
}


/**
 * Converts a number second value to a string on the format HH:MM:SS
 * 
 * @param {number} [seconds] the seconds to be used for the timestamp
 * 
 * @return {string} The timestamp
 */
export function secondsToTimestamp(seconds : number) : String{
        var timestamp = "" + seconds % 60;
        if(timestamp.length<2){
            timestamp = "0"+timestamp;
        }
        seconds -= seconds % 60;
        const minutes = Math.floor(seconds/(60));
        timestamp=minutes%60+":"+timestamp;
        if(timestamp.length<5){
            timestamp = "0"+timestamp;
        }
        if(minutes/(60)>=1){
            const hours = Math.floor(minutes/(60));
            timestamp=hours+":"+timestamp;
    }
    return timestamp;
}
