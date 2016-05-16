# Murmur
This is a simple webapp for collecting speech samples for voice
recognition testing and training.

Running it should be as simple as issuing these commands on your
server:

```
> git clone git@github.com:mozilla/murmur.git
> cd murmur
> npm install
> emacs server.conf      # define hostname and email address for letsencrypt
> mkdir uploads          # create a directory for audio uploads
> emacs sentences.txt    # add some sentences to the config file
> screen                 # do this so the server will run after logout
> sudo node murmur.js    # start the server
```

For cloud services like AWS, you may also need to take steps to open
ports 80 and 443 on your server before this code will work
