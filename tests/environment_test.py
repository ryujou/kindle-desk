import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'pc'))
import environment


class WeatherDetailsTest(unittest.TestCase):
    def test_forecast_fields_and_hour_boundary_reserve(self):
        forecast = dict(
            current=dict(temperature_2m=22, weather_code=2),
            hourly=dict(time=list(range(0, 36000, 3600)), temperature_2m=[21] * 10,
                        weather_code=[61] * 10, precipitation_probability=[None, 0, 12, 30, 80, 90, 100, 45, 30, 0]),
            daily=dict(time=[0, 86400], temperature_2m_min=[16, 17], temperature_2m_max=[25, 26]))
        with patch.object(environment.opener, 'open', return_value=io.BytesIO(json.dumps(forecast).encode())) as request:
            with patch.object(environment.time, 'time', return_value=1):
                result = environment.fetch_weather(0, 0)
        self.assertEqual(len(result['hours']), 7)
        self.assertEqual(result['hours'][0]['at'], 3600)
        self.assertEqual(result['hours'][-1]['rainProbability'], 45)
        self.assertEqual(result['today']['minimum'], 16)
        self.assertTrue(result['forecastRain'])
        self.assertIn('precipitation_probability', request.call_args.args[0])
        self.assertEqual(result['sampledAt'], 1)


if __name__ == '__main__':
    unittest.main()
