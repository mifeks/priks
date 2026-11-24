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

## Что стоит знать

- Порт 8777 наружу не открывается: снаружи только 80/443 через nginx.
- Пароли хранятся как SHA256 с солью, токены — случайные строки, живут в `store.json`.
- Сообщения режутся на 4000 символов, в хранилище держится последние 20 000.
- Один сервер спокойно держит несколько сотен человек: клиент опрашивает `/api/poll`
  раз в секунду, без WebSocket.
