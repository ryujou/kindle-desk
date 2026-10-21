"""Local input activity and weather at the user-approved computer location."""
import ctypes
from ctypes import wintypes
import hashlib
import json
from pathlib import Path
import socket
import struct
import time
import urllib.request

LOCATION_FILE = Path.home() / '.codex/kindle-desk/environment.json'
PURIFIER_FILE = LOCATION_FILE.with_name('purifier.json')
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
last_break = time.monotonic()


class LastInputInfo(ctypes.Structure):
    _fields_ = [('cbSize', wintypes.UINT), ('dwTime', wintypes.DWORD)]


def presence_status():
    global last_break
    info = LastInputInfo()
    info.cbSize = ctypes.sizeof(info)
    if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(info)):
        raise ctypes.WinError()
    # LASTINPUTINFO uses a 32-bit tick count, which wraps after 49.7 days.
    idle_seconds = ((ctypes.windll.kernel32.GetTickCount() - info.dwTime) & 0xffffffff) / 1000
    away = idle_seconds >= 300
    if away:
        last_break = time.monotonic()
    return dict(sittingSeconds=int(time.monotonic() - last_break), away=away)


def fetch_weather(latitude, longitude):
    url = ('https://api.open-meteo.com/v1/forecast?latitude=%s&longitude=%s'
           '&current=temperature_2m,weather_code&hourly=weather_code,temperature_2m,precipitation_probability'
           '&daily=temperature_2m_max,temperature_2m_min'
           '&forecast_days=2&timeformat=unixtime&timezone=auto') % (latitude, longitude)
    with opener.open(url, timeout=8) as response:
        forecast = json.load(response)
    current, now = forecast['current'], int(time.time())
    rain_codes = set(range(51, 68)) | set(range(80, 83)) | set(range(95, 100))
    rain = any(code in rain_codes for stamp, code in
               zip(forecast['hourly']['time'], forecast['hourly']['weather_code'])
               if now <= stamp <= now + 6 * 3600)
    hourly = forecast['hourly']
    hours = [dict(at=stamp, temperature=temperature, code=code, rainProbability=probability)
             for stamp, temperature, code, probability in zip(hourly['time'], hourly['temperature_2m'],
                 hourly['weather_code'], hourly['precipitation_probability']) if stamp >= now][:7]
    daily = forecast['daily']
    return dict(temperature=current['temperature_2m'], code=current['weather_code'],
                forecastRain=rain, sampledAt=now, hours=hours,
                today=dict(at=daily['time'][0], minimum=daily['temperature_2m_min'][0],
                           maximum=daily['temperature_2m_max'][0]))


def fetch_indoor(ip, token):
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    from cryptography.hazmat.primitives.padding import PKCS7

    token = bytes.fromhex(token)
    # MiIO requires MD5 for AES key/IV derivation and packet checksums.
    key = hashlib.md5(token).digest()
    iv = hashlib.md5(key + token).digest()
    request_id = int(time.time())
    raw = json.dumps(dict(id=request_id, method='get_prop',
                          params=['temp_dec', 'humidity', 'aqi'])).encode()
    pad = PKCS7(128).padder()
    padded = pad.update(raw) + pad.finalize()
    encrypt = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
    payload = encrypt.update(padded) + encrypt.finalize()
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as device:
        device.settimeout(3)
        device.connect((ip, 54321))
        device.send(bytes.fromhex('21310020' + 'ff' * 28))
        hello = device.recv(2048)
        if len(hello) != 32 or hello[:2] != b'!1':
            raise ValueError('Invalid MiIO handshake')
        header = struct.pack('!HHI', 0x2131, len(payload) + 32, 0) + hello[8:16]
        device.send(header + hashlib.md5(header + token + payload).digest() + payload)
        packet = device.recv(8192)
    if packet[:2] != b'!1' or len(packet) < 48 or struct.unpack('!H', packet[2:4])[0] != len(packet):
        raise ValueError('Invalid MiIO response')
    if hashlib.md5(packet[:16] + token + packet[32:]).digest() != packet[16:32]:
        raise ValueError('Invalid MiIO response checksum')
    decrypt = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
    padded = decrypt.update(packet[32:]) + decrypt.finalize()
    unpad = PKCS7(128).unpadder()
    result = json.loads((unpad.update(padded) + unpad.finalize()).rstrip(b'\x00'))
    if result.get('id') != request_id or 'error' in result:
        raise ValueError('MiIO property request failed')
    temperature, humidity, pm25 = result['result']
    if temperature is None or humidity is None or pm25 is None:
        return None
    return dict(temperature=temperature / 10, humidity=humidity, pm25=pm25,
                sampledAt=int(time.time()))


class EnvironmentReader:
    def __init__(self):
        self.weather = None
        self.indoor = None
        self.coordinates = None
        self.next_fetch = 0

    def poll(self):
        if not LOCATION_FILE.exists():
            return
        value = json.loads(LOCATION_FILE.read_text(encoding='utf-8'))
        coordinates = (value['latitude'], value['longitude'])
        if coordinates != self.coordinates or time.monotonic() >= self.next_fetch:
            self.next_fetch = time.monotonic() + 1800
            self.coordinates = coordinates
            self.weather = fetch_weather(*coordinates)

    def poll_indoor(self):
        if not PURIFIER_FILE.exists():
            self.indoor = None
            return
        value = json.loads(PURIFIER_FILE.read_text(encoding='utf-8'))
        self.indoor = fetch_indoor(value['ip'], value['token'])
