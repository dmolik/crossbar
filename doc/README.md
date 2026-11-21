## INSTALL

Packages are attached to each [release](https://github.com/dmolik/crossbar/releases).

#### Chromium

- Download and unzip `crossbar_<version>.chromium.zip`.
- Rename the unzipped directory to `crossbar`
    - When you later update manually, replace the **content** of the `crossbar` folder with the **content** of the latest zipped version.
    - As long as the extension loads **from same folder path from which it was originally installed**, all your settings will be preserved.
- Go to `chrome://extensions`.
- Turn on *Developer mode*.
- Click *Load unpacked*.
- Select the `crossbar` directory created above.

Remember that you have to update manually also.

#### Firefox

The release `.xpi` is not signed by Mozilla yet, so release builds of Firefox refuse to install it. Until it is, load it as a temporary add-on from `about:debugging` (it is removed when Firefox quits), or use Firefox Developer Edition or Nightly with `xpinstall.signatures.required` set to `false` in `about:config`.

## MOVING FROM uMATRIX

Crossbar is a separate extension from uMatrix, so it can't read uMatrix's settings directly. To bring them over:

1. In uMatrix, open the dashboard, go to *About*, and click *Back up to file*.
2. In Crossbar, open the dashboard, go to *About*, click *Restore from file*, and pick that backup.

This restores your rules, settings, hosts files selection and advanced settings. Rules exported from uMatrix's *My rules* pane, and ruleset recipe files written for uMatrix, can also be imported as they are.
