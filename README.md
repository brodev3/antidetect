# Anti-detect browser
<p>
      <img src="https://i.ibb.co/3sHQCSp/av.jpg" >
</p>

<p >
   <img src="https://img.shields.io/badge/build-v_1.1-brightgreen?label=Version" alt="Version">
</p>





## About

A console application with a simple user interface for managing and working with browser profiles with anti-detection protection. 

It is based on the [browser-with-fingerprints](https://github.com/CheshireCaat/browser-with-fingerprints) plugin, which allows you to change your browser fingerprint, create a virtual identity and increase the secrecy of your browser. 

This is done using the [FingerprintSwitcher](https://fingerprints.bablosoft.com/) service, which allows you to replace a list of important browser properties, so you will behave like a completely new user.

The application will allow you to increase your anonymity on the web. You can use multi-accounts on any platforms as different users. Thanks to the simple console interface, you don't need any skills to use antidetect. This project is for the community and I will gradually develop and improve it in the future. 

## Usage

> [!NOTE]
> This section I plan to regularly add and improve the application for users (if there will be any)...
> 
### Profile manager

 Using the user interface you can create an unlimited number of Chromium profiles and interact with them. 

 Profiles are available in the profile list, sorted by the age of the profile, where you can select any profile and interact with it.

The list of profiles is closed, moving the cursor next on the last profile will take you to the first profile and vice versa. 

<p align="center">
      <img src="https://i.ibb.co/xSPb3fL/image-2023-12-10-02-42-04.png" >
</p>

**Standard features:** 
- open, 
- delete
- rename, 
- proxy connection,
- fingerprint change.

  
  <p align="center">
      <img src="https://i.ibb.co/cLmGXTX/image-2023-12-10-03-12-29.png" >
</p>

### Fingerprint

When you create a profile you get a new fingerprint and save it to use it in future work. 
Available options:
- change fingerprint,
- delete fingerprint, will be use the fingerprint of your device.
  
The [FingerprintSwitcher](https://fingerprints.bablosoft.com/) service provides free fingerprints that are used in the application. This gives us unique browser properties that we apply to our profiles. 

The main properties are:
- UserAgent,
-  navigator,
- WebGL,
- WebRTC,
- screen and viewport
  (free mode is limited and you can get a print with a large screen size,
you can apply the size of your monitor to the profile,
to do this you need to move the profile window to the top border of the screen with the cursor),
- Timezone,
- Language,
 - Devices,
- fonts,
- etc...
  
The full list can be viewed on the service's website.

### Proxy

You can use a proxy for each profile.
Available options:
- set proxy,
- delete proxy, will be use real IP.
  
The browser supports two types of proxy servers - https and socks5. 

Proxies with authorization (with login and password) are also supported. Changing browser time zone and languages depending on proxy.
### Cloud

For teamwork, saving space on your device and accessibility, you can use the cloud to store profile data.

 I use google drive, that way you can work with your profiles from different devices.

## Installation and launch

## Guides

## Future development

- [Service Name](Page Link)

## License

Project **brodev3**/antidetect is distributed under the MIT license.
