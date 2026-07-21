import pytest
from unittest.mock import patch
from homeassistant.core import HomeAssistant
from custom_components.pukalani_birdnet.sensor import BirdNetSensor

def test_sensor_creation(hass: HomeAssistant):
    coordinator_mock = patch("custom_components.pukalani_birdnet.coordinator.BirdNetCoordinator").start()
    sensor = BirdNetSensor(coordinator_mock, "test_id", "Test Sensor", "mdi:test", "unit", "test_key")
    
    assert sensor.name == "Test Sensor"
    assert sensor.icon == "mdi:test"
    assert sensor.native_unit_of_measurement == "unit"
