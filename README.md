# Antidetect browser
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

The aim of my project, the "Antidetect browser," is to empower users with the ability to create and manage multiple virtual browser profiles, ensuring their anonymity and privacy online. Through the "Antidetect browser," users gain the following capabilities:

- **Creating Custom Browser Profiles**: Users can craft browser profiles tailored to their specific needs, with unique configurations and settings.
- **Proxy Integration**: Each profile supports the integration of proxy servers, enabling anonymous connections to the Internet.

- **Fingerprint Masking**: I've implemented features to mask and alter digital browser fingerprints like User-Agent and Canvas Fingerprint, allowing users to evade tracking systems effectively.

- **Enhanced Privacy Features**: Users have the ability to disable potentially identifying features such as WebRTC and Canvas Fingerprinting, thus elevating their level of anonymity and privacy.

- **Secure Data Management**: The project provides users with the means to manage their own data storage for each profile, ensuring data isolation and privacy between profiles.

With the "Antidetect browser," I aim to offer users a comprehensive toolset to navigate the online world with confidence, knowing that their privacy and anonymity are prioritized.

## Review

### Profiles
Profiles is a individual browser instances, similar to profiles in the Google Chrome browser. Each profile has its own storage, settings, and data, which can be stored either in the cloud for accessibility and synchronization across devices or locally on your system for increased confidentiality and security.
<p align="center">
      <img src="https://i.ibb.co/SNbBrNz/1.gif" >
</p>
The application provides a convenient and simple interface accessible through a console application. Users can easily create and manage profiles, including setting up proxy connections and spoofing browser fingerprints.

### Dashboard

The Dashboard is a Google Sheets document containing information about browser profiles. With this table, you can easily manage your profiles, make changes, and track relevant information.

What you can do with the Dashboard:

- **Sorting and Filtering**: Easily find information by sorting and filtering data in the table.

- **Profile Management**: Create and modify profiles, configuring proxies and fingerprinting.

- **Choosing Profiles for Work**: Simply select the desired profiles from the Dashboard for use in the console application. To do this, set the value "X" for the select column in the profile row.

This table serves as a database for the application. Information from the cells is used to open the browser, such as profile name and proxy settings.

The Dashboard makes managing your profiles quick, convenient, and efficient.

<p align="center">
      <img src="https://i.ibb.co/wYQ9jD5/image-2024-02-21-05-23-39.png" >
</p>

The Dashboard can be customized to suit your needs, with additional columns added to track more information. In the example below, four additional parameters are included: Gmail, Twitter, Telegram, and Discord. These indicate the presence of an active session in the profile on each platform. You can easily track the status of your profiles across different platforms directly from the Dashboard.


### Fingerprint

The application allows you to change the digital fingerprint of each profile. When creating a new profile, a digital fingerprint is assigned to it, which you can later modify. Using the [FingerprintSwitcher](https://fingerprints.bablosoft.com/#home), we obtain the real fingerprint in JSON format and apply it to open the profile with that fingerprint.

The service offers extensive capabilities for effective masking, the main ones of which are outlined below.
<p align="center">
      <img src="https://i.ibb.co/d67mf4W/2.png" >
</p>
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

The browser supports proxies, you can configure them in both the dashboard and the console application. The following connection protocols are available: HTTPS and SOCKS5, you can connect to proxies using login and password is possible. 

The browser automatically sets the time, language, and geolocation according to your proxy settings, and also prevents IP address leakage through WebRTC.
### Cloud
> [!NOTE]
> In development...
>
> 
You have convenient storage options for profile data, both locally and in the cloud. Forget about the limitations of a single device — cloud storage allows you to access your profiles from any device or collaborate within a team. 

For cloud integration, you need a service that provides a virtual disk, displaying the contents of your cloud storage

## Installation and launch

## Guides

## Future development

- [Service Name](Page Link)

## License

Project **brodev3**/antidetect is distributed under the MIT license.
