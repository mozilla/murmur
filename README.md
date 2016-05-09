# speecher
This is a simple webapp for collecting speech samples for voice
recognition testing and training.

Running it should be as simple as issuing these commands on your
server:

```
> git clone git@github.com:mozilla/speecher.git
> cd speecher
> npm install
> mkdir uploads       # create a directory for audio uploads
> emacs sentences.txt # add some sentences to the config file
> emacs server.conf   # define hostname and email address for letsencrypt
> sudo node speecher.js
```
