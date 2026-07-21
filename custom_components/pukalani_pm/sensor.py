from homeassistant.components.sensor import SensorEntity
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from .const import DOMAIN

async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data[DOMAIN][entry.entry_id]
    
    sensors = [
        PMSensor(coordinator, "total_tasks", "Total Tasks", "mdi:format-list-bulleted"),
        PMSensor(coordinator, "active_tasks", "Active Tasks", "mdi:format-list-checks"),
        PMSensor(coordinator, "overdue_tasks", "Overdue Tasks", "mdi:alert-circle-outline"),
        PMSensor(coordinator, "total_vendors", "Total Vendors", "mdi:account-group"),
        PMSensor(coordinator, "total_assets", "Total Assets", "mdi:cube"),
        PMSensor(coordinator, "warranties_expiring", "Warranties Expiring", "mdi:shield-alert"),
    ]
    
    async_add_entities(sensors)

class PMSensor(CoordinatorEntity, SensorEntity):
    def __init__(self, coordinator, key, name, icon):
        super().__init__(coordinator)
        self._key = key
        self._attr_name = f"PM {name}"
        self._attr_unique_id = f"{DOMAIN}_{key}"
        self._attr_icon = icon

    @property
    def native_value(self):
        return self.coordinator.data.get(self._key, 0)
