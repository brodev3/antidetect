# Руководство по использованию Антидетект Браузера

## Оглавление
1. [Для запуска профиля](#для-запуска-профиля)
2. [Для работы](#для-работы)
3. [Примечания](#примечания)
1. [Таблица](###Google)

## Для запуска профиля
1. Таблица
2. API
3. Диск
4. Установка
5. Настройка
6. Запуск



## Для работы
1. Профили
2. Дашборд
3. Облако

## Примечания

Это лишь пример оформления. Вы можете добавить более подробное описание и инструкции к каждой главе, а также вставить ссылки на соответствующие разделы кода или других ресурсов.

### Step 1: Google spreadsheet

1. Open Google Sheets in your web browser.
2. Create a copy of the "Dashboard" template on your drive by following the template link and selecting "File" -> "Make a copy".
3. Rename the copied file as desired, for example, "AntiDashboard".
4. Now you have your own copy of the "Dashboard" template that you can customize and use in your antidetect browser.

### Step 2: Google API

1. Go to the Google Developers Console
2. Select your project or create a new one (and then select it)
3. Enable the Sheets API for your project
- In the sidebar on the left, select Enabled APIs & Services
- Click the blue "Enable APIs and Services" button in the top bar
- Search for "sheets"
- Click on "Google Sheets API"
- Click the blue "Enable" button
4. (Optional) Enable the "Google Drive API" for your project - if you want to manage document permissions
- same as above, but search for "drive" and enable the "Google Drive API"

Next, you need to create and connect as a service bot user that belongs to your app.
Follow steps above to set up project and enable sheets API:

- Create a service account for your project
- In the sidebar on the left, select APIs & Services > Credentials
- Click blue "+ CREATE CREDENTIALS" and select "Service account" option
- Enter name, description, click "CREATE"
- You can skip permissions, click "CONTINUE" and "DONE"
- In the 'Credentials' menu, under the "Service Accounts" section, select the created account and click on it
- In the top menu, select the "Keys" section
- Click on the 'Add key' button and choose "Create new key"
- Select the type as "JSON" and click on "Create"

A JSON file containing the login credentials will be downloaded, which we will need for further use.

### Step 3: Google Drive




dsdsdsdsd
