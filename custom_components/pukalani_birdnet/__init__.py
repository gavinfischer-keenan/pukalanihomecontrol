"""The Pukalani BirdNET-Go integration."""
import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.const import Platform
import aiohttp

from .const import DOMAIN, CONF_URL
from .coordinator import BirdNetCoordinator

PLATFORMS: list[Platform] = [Platform.SENSOR]

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Pukalani BirdNET-Go from a config entry."""
    url = entry.data[CONF_URL]
    coordinator = BirdNetCoordinator(hass, url)

    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    async def handle_review(call: ServiceCall):
        """Handle the review service call."""
        detection_id = call.data.get("detection_id")
        species = call.data.get("species")
        verified = call.data.get("verified", True)
        
        session = async_get_clientsession(hass)
        payload = {"species": species, "verified": verified}
        try:
            async with session.post(f"{url}/api/v2/detections/{detection_id}/review", json=payload) as response:
                response.raise_for_status()
        except Exception:
            pass

    async def handle_lock(call: ServiceCall):
        """Handle the lock service call."""
        detection_id = call.data.get("detection_id")
        session = async_get_clientsession(hass)
        try:
            async with session.post(f"{url}/api/v2/detections/{detection_id}/lock") as response:
                response.raise_for_status()
        except Exception:
            pass

    async def handle_refresh(call: ServiceCall):
        """Handle the refresh service call."""
        await coordinator.async_request_refresh()

    hass.services.async_register(DOMAIN, "review", handle_review)
    hass.services.async_register(DOMAIN, "lock", handle_lock)
    hass.services.async_register(DOMAIN, "refresh", handle_refresh)

    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    if unload_ok := await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        hass.data[DOMAIN].pop(entry.entry_id)

    return unload_ok
