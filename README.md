# snabba-schemat

Wow this readme was empty...

## SSL Setup
I have used [GetSSL](https://github.com/srvrco/getssl) to get the ssls via Lets Encrypt, and it seems to be working :)
The config is in the `getssl_config` folder, but is very specific and will need to be updated (atleast the paths)
To use it, simply make sure the config files are correct, then disable *https* mode, (run the server in *http* mode), run `./getssl snabbaschemat.live` and wait for it to generate the key. It should be automatic. Then enable the server using *https* mode again and it should be up and running, using the new key.
