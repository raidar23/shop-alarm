MAGIC GARDEN SHOP ALARM - WEBSITE SERVER
========================================

This folder runs the Shop Alarm website on this PC and puts it on the internet.
People open the link in any browser (PC or phone), pick the items they want, and the
page rings when they're in the shop. There's no game on the site and no buying.

START
  Double-click "Start Shop Alarm Server.bat".
  After about a minute a box shows the public link (https://....trycloudflare.com).
  It's also copied, and saved in "public-link.txt".
  A little bell appears by the clock: right-click it to open the website or stop the server.

STOP
  Double-click "Stop Shop Alarm Server.bat".

START BY ITSELF WHEN THE PC TURNS ON
  Double-click "Start With Windows.bat" once.
  (Undo: press Win+R, type shell:startup, delete "Shop Alarm Server".)

KEEP THE PC AWAKE
  The site is only online while this PC is on and awake. In Windows Settings >
  System > Power, set "Make my device sleep after" to Never (when plugged in).

THE LINK
  The free link changes every time the server restarts (for example after a reboot).
  Check public-link.txt for the current one. A link that never changes needs a free
  Cloudflare or ngrok account.

GITHUB PAGES (a link that never changes)
  The website also lives on GitHub Pages (the repository is named in github-repo.txt). Each time the
  server starts, it tells that page where it is now, so visitors can always use the github.io link
  (it can take a few minutes to catch up after a restart). For that, sign this PC in to GitHub once:
  double-click "Sign in to GitHub.bat", enter the code it shows on GitHub's page, click Authorize.
  (Instead of signing in, a file github-token.txt with a fine-grained token for that one repository,
  "Contents: Read and write", works too.)

WHAT'S IN HERE
  app\            the Shop Alarm app (runs in "server mode": no window, no sounds)
  runtime\        Electron, which runs the app
  cloudflared.exe Cloudflare's tunnel tool (makes the public link)
