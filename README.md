# Donkey Kong '94 Web Level Editor

This is a simple web-based port of the hard work done by [bailli](https://github.com/bailli), who built the fantastic C++/QT version of the [Donkey Kong '94 Level Editor](https://github.com/bailli/eDKit).

[Main Interface](./docs/main-interface.png)

The main reason for doing this was to make it easier for people without too much computer experience to be able to edit the levels of Donkey Kong '94, and to make it more accessible to people on different platforms. I also had some issues running it on Windows, with palettes being incorrect. The web version also contains a feature to test levels in the browser. This is done using [Wasmboy](https://wasmboy.app/).

## Requirements

You'll need a version of the _original_ Donkey Kong 94 Gameboy cartridge ROM. There is another revision (1.1/World) which will not work in this editor.

The editor has been tested on Chrome and Brave. In theory, it should work on any modern browser.

## Notes

In order to test levels, or save the changes to the ROM, you need to click the "Apply" button first.

The game engine is also quite tempremental as to what it finds acceptable. I've replicated what's been in eDKit as closely as possible, and many of the same quirks in that editor and this one are the same. If the level is unacceptable, the game will crash. It's also been known to have weird behaviour like finishing levels early, placing the player in weird places, or getting the player into a position where they can't move.