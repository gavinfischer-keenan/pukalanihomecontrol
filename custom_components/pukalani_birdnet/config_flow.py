"""Config flow for Pukalani BirdNET-Go integration."""
import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
import aiohttp

from .const import DOMAIN, CONF_URL, DEFAULT_URL

STEP_USER_DATA_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_URL, default=DEFAULT_URL): str,
    }
)

async def validate_input(hass: HomeAssistant, data: dict) -> dict:
    """Validate the user input allows us to connect."""
    url = data[CONF_URL]
    session = async_get_clientsession(hass)
    try:
        async with session.get(f"{url}/api/v2/species") as response:
            response.raise_for_status()
    except aiohttp.ClientError as err:
        raise ValueError("cannot_connect") from err

    return {"title": "BirdNET-Go"}

class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Pukalani BirdNET-Go."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        """Handle the initial step."""
        errors = {}
        if user_input is not None:
            try:
                info = await validate_input(self.hass, user_input)
                return self.async_create_entry(title=info["title"], data=user_input)
            except ValueError:
                errors["base"] = "cannot_connect"
            except Exception:
                errors["base"] = "unknown"

        return self.async_show_form(
            step_id="user", data_schema=STEP_USER_DATA_SCHEMA, errors=errors
        )
