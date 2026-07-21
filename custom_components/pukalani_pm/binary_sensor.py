from homeassistant.components.binary_sensor import BinarySensorEntity, BinarySensorDeviceClass
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from .const import DOMAIN

async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([PMOnlineSensor(coordinator)])

class PMOnlineSensor(CoordinatorEntity, BinarySensorEntity):
    _attr_name = "PM API Online"
    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY
    
    def __init__(self, coordinator):
        super().__init__(coordinator)
        self._attr_unique_id = f"{DOMAIN}_api_online"

    @property
    def is_on(self):
        return self.coordinator.data.get("api_online", False)
