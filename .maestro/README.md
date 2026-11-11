# End-to-end flows

[Maestro](https://maestro.dev) flows that drive the iOS development build.

```sh
npm run ios                      # build and install the dev client once
npm start                        # Metro
npm run test:e2e                 # core journey on the booted simulator
maestro --device <UDID> test .maestro/core-journey.yaml   # a specific simulator
```

`sign-in.yaml` signs a fresh simulator in. It takes `EMAIL` and `PASSWORD` with `-e`.

On a fresh install run `dev-client.yaml` first. It connects the Expo dev client to
Metro, dismisses its first-run menu and moves its floating button out of the
top-right corner. Release builds have neither. If "New space" still opens the
developer menu, switch off **Tools button** in that menu and close it.

```sh
maestro --device <UDID> test .maestro/dev-client.yaml
maestro --device <UDID> test -e EMAIL=... -e PASSWORD=... .maestro/sign-in.yaml
maestro --device <UDID> test .maestro/core-journey.yaml
```
