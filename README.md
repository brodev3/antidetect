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

- **Selecting multiple profiles:**: Simply select the desired profiles from the Dashboard for use in the console application. To do this, set the value "X" for the select column in the profile row.

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
The effectiveness of this masking has been confirmed in practice. Test results are similar to another antidetect browser (AdsPower) and are presented below.



For testing, the following tools were used:
1. [CreepJS](https://abrahamjuliot.github.io/creepjs/)
2. [FingerprintJS](https://fingerprintjs.github.io/fingerprintjs/)
3. [Incolumitas](https://bot.incolumitas.com/)
4. [Fingerprint.com](https://fingerprint.com/products/bot-detection/)

<p align="center">
      <img src="https://i.ibb.co/r785yxp/creepsjs.png" >
</p>
<p align="center">
      <img src="https://i.ibb.co/VYH6BP3/fingerprintjs.png" >
</p>
<p align="center">
      <img src="https://i.ibb.co/zS4C6b4/Behavioral.png" >
</p>
<p align="center">
      <img src="https://i.ibb.co/J5Xdzds/fingerprint-com.png" >
</p>

Certainly, these results are quite subjective, but you can use this data to compare the Antidetect browser with AdsPower. Providing a real assessment of browser masking is challenging, but the free Antidetect browser demonstrates a level comparable to the paid AdsPower.

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

## Installation and guides


### Step 1: Google spreadsheet

1. Open Google Sheets in your web browser. 
2. Create a copy of the  ["Dashboard"](https://docs.google.com/spreadsheets/d/1Pjpjtm5p0bPSe_dJjwCMa8l5PUCoHooZRP7IFSV_SwU/edit?usp=sharing) template on your drive by following the template link and selecting "File" -> "Make a copy".
3. Rename the copied file as desired, for example, "AntiDashboard".
4. Now you have your own copy of the ["Dashboard"](https://docs.google.com/spreadsheets/d/1Pjpjtm5p0bPSe_dJjwCMa8l5PUCoHooZRP7IFSV_SwU/edit?usp=sharing) template that you can customize and use in your antidetect browser.


### Step 2: Google API

1. Go to the [Google Developers Console](https://console.cloud.google.com/cloud-resource-manager?pli=1)
2. Select your project or create a new one (and then select it)
3. Enable the Sheets API for your project
- In the sidebar on the left, select Enabled APIs & Services
- Click the blue "Enable APIs and Services" button in the top bar
- Search for "sheets"
- Click on ["Google Sheets API"](https://console.cloud.google.com/apis/library/sheets.googleapis.com?project=)
- Click the blue "Enable" button
4. (Optional) Enable the "Google Drive API" for your project - if you want to manage document permissions
- same as above, but search for "drive" and enable the "Google Drive API"

Next, you need to create and connect as a service bot user that belongs to your app.
Follow steps above to set up project and enable sheets API:

- Create a service account for your project
- In the sidebar on the left, select [APIs & Services > Credentials](https://console.cloud.google.com/apis/credentials?project=)
- Click blue "+ CREATE CREDENTIALS" and select ["Service account"](https://console.cloud.google.com/iam-admin/serviceaccounts/create?previousPage=&project=) option
- Enter name, description, click "CREATE"
- You can skip permissions, click "CONTINUE" and "DONE"
- In the ['Credentials'](https://console.cloud.google.com/apis/credentials?project=) menu, under the "Service Accounts" section, select the created account and click on it
- In the top menu, select the "Keys" section
- Click on the 'Add key' button and choose "Create new key"
- Select the type as "JSON" and click on "Create"

A JSON file containing the login credentials will be downloaded, which we will need for further use.


### Step 3: Google Drive

1. Download and install [Google Drive](https://workspace.google.com/products/drive/#download) for desktop
2. Add the "My Drive" folder
- Open Google Drive, sign in with your account, and locate the "My Drive" folder in the main interface
3. Set up folder sync settings for "My Drive"
- In Google Drive settings, navigate to Preferences > My Drive
- Choose Sync all files and folders or Sync specific folders to specify files for syncing to your computer
5. Enable offline access for the folder
- Right-click on the "My Drive" folder and select Available offline to ensure access when you’re not connected to the internet
6. Create a folder named "antidetect" in "My Drive"


### Step 4: Environment Configuration Guide

To configure the `.env` file, follow these steps:
1. **Rename** `.env_example` to `.env`
2. **Set the following variables** in the `.env` file:

    ```plaintext
    DIR = ""
    GOOGLEEMAIL = ""
    GOOGLESHEETID = ""
    FPKEY = ""
    GOOGLEKEY = ""
    NODE_ENV = "test"
    ```

- **DIR**: The path to the `antidetect` directory on Google Drive.
- **GOOGLEEMAIL**: The `client_email` field from the JSON file of your Google Service Account.
- **GOOGLESHEETID**: The ID of the Google Sheet. You can find this in the URL on the dashboard page, located between `docs.google.com/spreadsheets/d/` and `/edit?`.
- **FPKEY**: The fingerprinting key provided by [Bablosoft](https://fingerprints.bablosoft.com/).
- **GOOGLEKEY**: The `private_key` field from the JSON file of your Google Service Account.
- **NODE_ENV**: The environment setting. Don't change

> ⚠️ **Note**: Ensure that all sensitive keys and paths are accurately set to prevent configuration issues.

## How to Start

1. Node JS
2. Clone the repository to your disk
3. Configure ```.env``` with the appropriate parameters
4. Launch the console (for example, Windows PowerShell)
5. Specify the working directory where you have uploaded the repository in the console using the CD command
    ```
    cd C:\Program Files\brothers
    ```
6. Install packages
   
    ```
    npm install
    ```
7. Run the software
    ```
    node index
    ```

## Future development

> [!NOTE]
> This section I plan to regularly add and improve the application for users (if there will be any)...
> 



## License

Project **brodev3**/antidetect is distributed under the MIT license.
