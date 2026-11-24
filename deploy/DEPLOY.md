# Прикс на виртуальной машине в Yandex Cloud

Пошаговая инструкция. Всё, что ниже, делается один раз; потом обновление — только пункт 9.

## 1. Создать виртуальную машину

В консоли Yandex Cloud: **Compute Cloud → Виртуальные машины → Создать**.

- Образ: **Ubuntu 24.04 LTS**
- Платформа: Intel Ice Lake, 2 vCPU, **2 ГБ RAM** (хватает на 100–200 человек)
- Диск: 20 ГБ SSD
- Публичный IP: **выделить статический** (иначе адрес сменится после перезагрузки)
- Группа безопасности: открыть входящие порты **22, 80, 443**

Имя пользователя по умолчанию — `ubuntu`, вход по SSH-ключу (ключ создаётся при создании ВМ).

## 2. Подключиться

```bash
ssh ubuntu@<ПУБЛИЧНЫЙ_IP>
```

## 3. Поставить Node.js 20

```bash
sudo apt update
sudo apt install -y curl nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```

## 4. Разложить файлы

Скопировать с локального компьютера папки `server-node` и `web`:

```bash
# выполнять на своём компьютере, не на сервере
scp -r server-node web ubuntu@<ПУБЛИЧНЫЙ_IP>:/tmp/priks
```

На сервере:

```bash
sudo mkdir -p /opt/priks /var/lib/priks
sudo cp -r /tmp/priks/server-node /opt/priks/
sudo cp -r /tmp/priks/web /opt/priks/
sudo useradd -r -s /usr/sbin/nologin priks || true
sudo chown -R priks:priks /opt/priks /var/lib/priks
```

## 5. Служба systemd

```bash
sudo cp /opt/priks/server-node/../deploy/priks.service /etc/systemd/system/ 2>/dev/null || true
```

Если файла `deploy/priks.service` рядом нет, создать его:

```bash
sudo tee /etc/systemd/system/priks.service > /dev/null <<'EOF'
[Unit]
Description=Priks messenger server
After=network.target

[Service]
Type=simple
User=priks
Group=priks
WorkingDirectory=/opt/priks/server-node
Environment=PORT=8777
Environment=HOST=127.0.0.1
Environment=WEB_DIR=/opt/priks/web
Environment=DATA_DIR=/var/lib/priks
Environment=ADMIN_NICKS=admin
Environment=PUBLIC_URL=https://priks.ru
Environment=YANDEX_CLIENT_ID=
Environment=YANDEX_CLIENT_SECRET=
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
```

Запуск:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now priks
sudo systemctl status priks --no-pager
curl -s localhost:8777/health
```

Ответ `{"ok":true,...}` — сервер жив.

### Админ и модерация

`ADMIN_NICKS` — список ников через запятую, которым разрешены `ban`, `unban` и `bans`.
В примере выше админом сделан ник `admin`: после регистрации этого ника
в чат-клиенте модерация доступна через API (см. раздел «Модерация» ниже).
Сменить список — поправить строку `Environment=ADMIN_NICKS=...` и выполнить
`sudo systemctl restart priks`.

### Вход через Яндекс

Вход по нику и паролю работает всегда. Кнопка «Войти через Яндекс» появляется,
только если на сервере заданы `YANDEX_CLIENT_ID` и `YANDEX_CLIENT_SECRET`.

1. Открыть https://oauth.yandex.ru/client/new и создать приложение:
   - платформа — «Веб-сервисы»;
   - Redirect URI — `https://priks.ru/auth/yandex/callback` (ровно тот же домен,
     что в `PUBLIC_URL`, без слэша на конце);
   - доступ — «Яндекс.ID: логин, имя, фамилия, портрет» (минимум `login:email`
     и `login:info`).
2. Скопировать из карточки приложения `ClientID` и `Client secret`.
3. Вписать их в `/etc/systemd/system/priks.service`:

```bash
sudo sed -i 's|^Environment=YANDEX_CLIENT_ID=.*|Environment=YANDEX_CLIENT_ID=ваш-client-id|' /etc/systemd/system/priks.service
sudo sed -i 's|^Environment=YANDEX_CLIENT_SECRET=.*|Environment=YANDEX_CLIENT_SECRET=ваш-client-secret|' /etc/systemd/system/priks.service
sudo sed -i 's|^Environment=PUBLIC_URL=.*|Environment=PUBLIC_URL=https://priks.ru|' /etc/systemd/system/priks.service
sudo systemctl daemon-reload && sudo systemctl restart priks
```

4. Проверить: `curl -s localhost:8777/auth/status` → `{"ok":true,"yandex":true}`.
   `false` — значит переменные не подхватились, смотреть `journalctl -u priks -n 30`.

Как это работает: сервер уводит на oauth.yandex.ru со случайным `state`
(живёт 10 минут, годится один раз), получает код, меняет его на токен,
забирает профиль с `login.yandex.ru/info` и ищет аккаунт по `yandexId`.
Первый вход создаёт ник из яндексового логина (`vasya`), при занятом нике —
`vasya-2`, `vasya-3`. Второй вход подхватывает тот же аккаунт и выдаёт новый
токен сессии. Пароль у таких аккаунтов не спрашивается: попытка войти по паролю
отвечает «этот ник входит через Яндекс». Баны действуют и на Яндекс-вход.

`PUBLIC_URL` нужен, если сервер стоит за nginx: по нему строится `redirect_uri`.
Если переменная пустая, сервер берёт домен из заголовка `Host` — работает
только когда клиент ходит на сервер напрямую, без прокси.

### Веб-версия на GitHub Pages

Клиент лежит в репозитории рядом с сайтом и открывается без сервера:
**https://mifeks.github.io/priks/app/**

Что нужно, чтобы он заработал:

1. В переменных службы указать, каким сайтам разрешено обращаться к API:

```bash
sudo sed -i 's|^Environment=CORS_ORIGINS=.*|Environment=CORS_ORIGINS=https://mifeks.github.io|' /etc/systemd/system/priks.service
sudo systemctl daemon-reload && sudo systemctl restart priks
```

`CORS_ORIGINS` — список источников через запятую (`https://mifeks.github.io,https://priks.ru`).
Пусто — разрешено всем (`*`), это удобно для тестов, но лучше ограничить.
Этот же список проверяется при возврате после входа через Яндекс, поэтому
чужие сайты не смогут получить токен.

2. Открыть https://mifeks.github.io/priks/app/ — клиент спросит адрес сервера,
   например `https://priks.ru` или `http://89.169.10.20:8777`. Адрес запоминается
   в браузере. Другой способ — вписать его один раз в `docs/app/config.js`:

```js
window.PRIKS_API = "https://priks.ru";
```

3. Вход через Яндекс с веб-версии: клиент уходит на `<сервер>/auth/yandex?return=<адрес клиента>`,
   сервер запоминает адрес возврата (проверив его по `CORS_ORIGINS`) и после входа
   возвращает браузер на клиент с токеном в `#auth=…`.
   Redirect URI в приложении Яндекса остаётся один — `https://priks.ru/auth/yandex/callback`.

**Про HTTPS.** GitHub Pages отдаётся по `https`, а браузер запрещает со страницы
`https` обращаться к `http` (mixed content). Поэтому либо:

- поставить домен и сертификат на сервер (`certbot`, см. раздел 7) — тогда адрес
  вида `https://priks.ru` работает отовсюду;
- либо открывать клиент прямо с сервера: `http://<IP>:8777` — сервер сам раздаёт
  ту же страницу, и она обращается к своему же адресу.

## 6. nginx как точка входа

```bash
sudo cp /tmp/priks/deploy/nginx-priks.conf /etc/nginx/sites-available/priks
```

Если файла нет, взять его из папки `deploy` репозитория и положить туда же вручную.
Внутри заменить `priks.example.com` на свой домен.

```bash
sudo ln -sf /etc/nginx/sites-available/priks /etc/nginx/sites-enabled/priks
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Проверка: `http://<ПУБЛИЧНЫЙ_IP>/` открывает Прикс.

## 7. Домен и HTTPS

1. В DNS домена добавить A-запись: `priks.твойдомен.ru → <ПУБЛИЧНЫЙ_IP>`.
2. Дождаться, пока запись разойдётся (`ping priks.твойдомен.ru`).
3. Выпустить сертификат:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d priks.твойдомен.ru
```

Certbot сам добавит TLS и редирект с HTTP. Продление — автоматически по таймеру.

## 8. Проверка

- `https://priks.твойдомен.ru/` — вход и чат
- `https://priks.твойдомен.ru/health` — `{"ok":true,...}`
- Зарегистрировать два ника в двух окнах и написать друг другу

В ПК-клиенте Прикса адрес сервера вводится в поле **«СЕРВЕР»** на экране входа
(по умолчанию там `http://127.0.0.1:8777`). Вписать `https://priks.твойдомен.ru`
или `http://<ПУБЛИЧНЫЙ_IP>:8777`, если домена нет.

## 9. Обновление кода

```bash
# с локального компьютера
scp -r web server-node ubuntu@<ПУБЛИЧНЫЙ_IP>:/tmp/priks-new
# на сервере
sudo rsync -a --delete /tmp/priks-new/web/ /opt/priks/web/
sudo rsync -a --delete /tmp/priks-new/server-node/ /opt/priks/server-node/
sudo chown -R priks:priks /opt/priks
sudo systemctl restart priks
```

## 10. Данные и бэкап

Пользователи, друзья и сообщения лежат в одном файле:

```
/var/lib/priks/store.json
```

Бэкап раз в сутки в Object Storage или на другой сервер:

```bash
sudo cp /var/lib/priks/store.json /var/lib/priks/backup-$(date +%F).json
```

Логи:

```bash
sudo journalctl -u priks -n 100 --no-pager
```

## Модерация

Команды выполняются обычным POST-запросом, `token` — токен админского ника:

```bash
# забанить на 2 часа с причиной
curl -s -X POST localhost:8777/api/ban \
  -H 'Content-Type: application/json' \
  -d '{"token":"<ТОКЕН_АДМИНА>","nick":"bob","reason":"спам","hours":2}'

# забанить навсегда
curl -s -X POST localhost:8777/api/ban \
  -H 'Content-Type: application/json' \
  -d '{"token":"<ТОКЕН_АДМИНА>","nick":"bob","reason":"спам"}'

# снять бан
curl -s -X POST localhost:8777/api/unban \
  -H 'Content-Type: application/json' -d '{"token":"<ТОКЕН_АДМИНА>","nick":"bob"}'

# кто забанен
curl -s -X POST localhost:8777/api/bans \
  -H 'Content-Type: application/json' -d '{"token":"<ТОКЕН_АДМИНА>"}'
```

Что происходит при бане:

- все сессии забаненного сразу перестают работать (его выбрасывает на экран входа);
- войти заново он не может — увидит причину и, если бан временный, время окончания;
- админа забанить нельзя, забаненного не добавить в друзья;
- баны лежат в `store.json` в поле `bans` и переживают перезапуск сервера;
- временный бан снимается сам, как только истечёт срок.

## Что стоит знать

- Порт 8777 наружу не открывается: снаружи только 80/443 через nginx.
- Пароли хранятся как SHA256 с солью, токены — случайные строки, живут в `store.json`.
- Сообщения режутся на 4000 символов, в хранилище держится последние 20 000.
- Анти-флуд: не чаще одного сообщения в 0,7 с и не больше 12 сообщений за 20 секунд.
  Счётчик живёт в памяти и сбрасывается при перезапуске.
- Один сервер спокойно держит несколько сотен человек: клиент опрашивает `/api/poll`
  раз в секунду, без WebSocket.
