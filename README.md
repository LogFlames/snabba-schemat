# snabba-schemat

This project was created to circumvent Skolplattformen's long login process (requiring 7 clicks and password almost every time). It loads the schedule and cashes it to allow instant access, as well as export to .ical which can be added to google calendar. To not accidentally leak some schedule the password is saved RSA encrypted in the cookies of the browser, upon a login request the backend checks that the credentials match against a hashed password to serve the cashed schedule. It also decrypts the actual plain-text password and uses it to login as the user to Skolplattformen and update the schedule. The way it's currently done it doesn't save the plain-text password anywhere, although this is of course impossible for the clients to verify.

Currently hosted on [snabbaschemat.se](https://snabbaschemat.se), but because it is limited to pupils of Norra Real (or probably all communal schools in Stockholm) I have a access-code lock.

If you are interested in a DEMO, or want to set it up yourself, add support for more schools or anything else, I'd be happy to help! Just create an issue.

Right, and it also pulls in the food-schedule and shows what's for lunch.

## SSL Setup
I have used [GetSSL](https://github.com/srvrco/getssl) to get the ssls via Lets Encrypt, and it seems to be working :)
The config is in the `getssl_config` folder, but is very specific and will need to be updated (atleast the paths)
To use it, simply make sure the config files are correct, then disable *https* mode, (run the server in *http* mode), run `./getssl snabbaschemat.live` and wait for it to generate the key. It should be automatic. Then enable the server using *https* mode again and it should be up and running, using the new key.

### By: Elias Lundell
