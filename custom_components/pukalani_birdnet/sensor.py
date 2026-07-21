"""Sensor platform for Pukalani BirdNET-Go."""
from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import BirdNetCoordinator

async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the sensor platform."""
    coordinator = hass.data[DOMAIN][entry.entry_id]
    
    sensors = [
        BirdNetSensor(coordinator, "birdnet_species_today", "Species Today", "mdi:bird", None, "species_today"),
        BirdNetSensor(coordinator, "birdnet_detections_today", "Detections Today", "mdi:history", None, "detections_today"),
        BirdNetSensor(coordinator, "birdnet_last_species", "Last Species", "mdi:bird", None, "last_species"),
        BirdNetSensor(coordinator, "birdnet_last_confidence", "Last Confidence", "mdi:percent", "%", "last_confidence"),
        BirdNetSensor(coordinator, "birdnet_top_species", "Top Species", "mdi:trophy", None, "top_species"),
    ]
    
    async_add_entities(sensors)

class BirdNetSensor(CoordinatorEntity[BirdNetCoordinator], SensorEntity):
    """Representation of a BirdNet Sensor."""

    def __init__(self, coordinator: BirdNetCoordinator, entity_id: str, name: str, icon: str, unit: str, key: str) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self.entity_id = f"sensor.{entity_id}"
        self._attr_name = name
        self._attr_icon = icon
        self._attr_native_unit_of_measurement = unit
        self._key = key
        self._attr_unique_id = f"{coordinator.url}_{entity_id}"

    @property
    def native_value(self):
        """Return the state of the sensor."""
        if self.coordinator.data is not None:
            return self.coordinator.data.get(self._key)
        return None
