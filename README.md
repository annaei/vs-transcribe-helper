# vs-transcribe-helper

Docs are out of date. This project is becoming a transcription extension for VS Code that lets you control VLC in ways that are useful when transcribing.

## Table of contents

1. [Install](#install-)
2. [How to use](#how-to-use-)
   * [VLC](#vlc-)
   * [Commands](#commands-)
     * [Shortcuts](#shortcuts-)

## Install [[&uarr;](#table-of-contents)]
Install from VSIX. 

## How to use [[&uarr;](#table-of-contents)]

Open (or create) a `settings.json` file in your `.vscode` subfolder of your workspace or edit your global settings by using `CTRL + ,` shortcut:

Add a `media.player` section and define one or more players:

```json
{
    "media.player": {
        "players": [
            {
                "name": "My Spotify player",
                "type": "spotify",
            },

            {
                "name": "My VLC player",
                "type": "vlc",
            }
        ]
    }
}
```

A player entry supports the following, common properties:

| Name | Description |
| ---- | --------- |
| `buttonPriorityOffset` | A custom offset value for controlling the priority of the buttons in the status bar. Default `10` |
| `connectOnStartup` | Connect on startup or not. Default `(true)` |
| `defaultOutputID` | The ID of the default output device. Default `1` |
| `defaultOutputName` | The name of the default output device. Default `Main device` |
| `description` | A description for the player. |
| `initialOutput` | The name of the output device, which should be selected after extension has been connected to the player. |
| `name` | A (display) name for the player. |
| `showNextButton` | Show button for playing NEXT track in status bar or not. Default `(true)` |
| `showPlayerName` | Show player name in status bar or not. Default `(false)` |
| `showPrevButton` | Show button for playing PREVIOUS track in status bar or not. Default `(true)` |
| `showRight` | Show buttons on the RIGHT side of status bar or not. Default `(false)` |
| `showToggleMuteButton` | Show button for toggle mute state in status bar or not. Default `(true)` |
| `showTogglePlayButton` | Show button for toggle play state in status bar or not. Default `(true)` |
| `showToggleRepeatingButton` | Show button for toggle repeating state in status bar or not. Default `(false)` |
| `showToggleShuffleButton` | Show button for toggle shuffle state in status bar or not. Default `(false)` |
| `showTrackSelectorButton` | Show button for selecting a track in status bar or not. Default `(true)` |
| `showVolumeButtons` | Show buttons to change volume in status bar or not. Default `(false)` |
| `type` | The type. |

### VLC [[&uarr;](#how-to-use-)]

To control your local [VLC player](https://www.videolan.org/vlc/), you have to activate [Lua HTTP service](https://wiki.videolan.org/VLC_HTTP_requests/).

First select `Tools >> Preferences` in the main menu:

<kbd>![VLC Setup Step 1](https://raw.githubusercontent.com/mkloubert/vs-media-player/master/img/vlc1.png)</kbd>

Show all settings and select the node `Interface >> Main interfaces` by activating `Web` in the `Extra interface modules` group:

<kbd>![VLC Setup Step 2](https://raw.githubusercontent.com/mkloubert/vs-media-player/master/img/vlc2.png)</kbd>

In the sub node `Lua` define a password in the `Lua HTTP`:

<kbd>![VLC Setup Step 3](https://raw.githubusercontent.com/mkloubert/vs-media-player/master/img/vlc3.png)</kbd>

Now save the settings and restart the application.

By default the HTTP service runs on port 8080.

If you already run a service at that port, you can change it by editing the `vlcrc` file, that contains the configuration. Search for the `http-port` value, change it (and uncomment if needed) for your needs (you also have to restart the player after that).

Look at the [FAQ](https://www.videolan.org/support/faq.html) (search for `Where does VLC store its config file?`) to get information about where `vlcrc` is stored on your system.

Now update your settings in VS Code:

```json
{
    "media.player": {
        "players": [
            {
                "name": "My VLC player",
                "type": "vlc",

                "password": "myPassword",
                "port": 8080
            }
        ]
    }
}
```

In that example, you can open [localhost:8080/requests/status.xml](http://localhost:8080/requests/status.xml) to check your configuration. Use the password from the settings and leave the username field blank.

An entry supports the following, additional settings:

| Name | Description |
| ---- | --------- |
| `host` | The host of the (Lua) HTTP service. Default `localhost` |
| `password` | The password for the (Lua) HTTP service. |
| `port` | The TCP port of the (Lua) HTTP service. Default `8080` |
| `showAllPlaylists` | Show all playlists or the first one only. Default `(false)` |

### Commands [[&uarr;](#how-to-use-)]

Press `F1` to open the list of commands and enter one of the following commands:

| Name | Description | ID | 
| ---- | --------- | --------- | 
| `Media Player: Connect` | Connects to a player. | `extension.mediaPlayer.connect` | 
| `Media Player: Disconnect` | Disconnects from a player. | `extension.mediaPlayer.disconnect` | 
| `Media Player: Execute player action` | Executes a player action | `extension.mediaPlayer.executePlayerAction` | 
| `Media Player: Register app for Spotify` | Opens the web page where a new app can be registrated. | `extension.mediaPlayer.spotify.registerApp` | 
| `Media Player: Search` | Search for a track or playlist inside a player. | `extension.mediaPlayer.search` | 
| `Media Player: Select item of playlist` | Selects an item of a playlist. | `extension.mediaPlayer.selectItemOfPlaylist` | 
| `Media Player: Select output` | Selects an output device for a player. | `extension.mediaPlayer.selectPlayerOutput` | 

#### Shortcuts [[&uarr;](#commands-)]

If you want to define shortcuts / hotkeys for one or more of the upper [commands](#commands-), have a look at the VS Code article [Key Bindings for Visual Studio Code](https://code.visualstudio.com/docs/getstarted/keybindings).
