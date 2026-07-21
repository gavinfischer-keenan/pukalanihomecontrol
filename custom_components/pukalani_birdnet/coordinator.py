"""DataUpdateCoordinator for Pukalani BirdNET-Go."""
from datetime import datetime, timedelta
import logging
from zoneinfo import ZoneInfo
import aiohttp

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DOMAIN, CONF_URL, UPDATE_INTERVAL

_LOGGER = logging.getLogger(__name__)

class BirdNetCoordinator(DataUpdateCoordinator):
    """Class to manage fetching BirdNET data."""

    def __init__(self, hass: HomeAssistant, url: str) -> None:
        """Initialize."""
        self.url = url
        self.session = async_get_clientsession(hass)
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(seconds=UPDATE_INTERVAL),
        )

    async def _async_update_data(self):
        """Fetch data from API endpoint."""
        try:
            return await self._fetch_data()
        except aiohttp.ClientError as err:
            raise UpdateFailed(f"Error communicating with API: {err}") from err
        except Exception as err:
            raise UpdateFailed(f"Unexpected error: {err}") from err

    async def _fetch_data(self):
        """Fetch data."""
        hawaii_tz = ZoneInfo("Pacific/Honolulu")
        now = datetime.now(hawaii_tz)
        start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
        start_timestamp = int(start_of_day.timestamp())
        end_timestamp = int(now.timestamp())

        data = {
            "detections_today": 0,
            "species_today": 0,
            "last_species": "None",
            "last_confidence": 0.0,
            "top_species": "None",
        }

        async with self.session.get(f"{self.url}/api/v2/detections?limit=1") as response:
            if response.status == 200:
                res = await response.json()
                items = res.get("items", [])
                if items:
                    last_det = items[0]
                    data["last_species"] = last_det.get("species", "None")
                    data["last_confidence"] = float(last_det.get("confidence", 0.0)) * 100

        async with self.session.get(f"{self.url}/api/v2/analytics/species/summary") as response:
            if response.status == 200:
                summary = await response.json()
                if summary:
                    top = max(summary, key=lambda k: summary[k].get("count", 0))
                    data["top_species"] = summary[top].get("species", top)

        async with self.session.post(
            f"{self.url}/api/v2/search", 
            json={"start_time": start_timestamp, "end_time": end_timestamp, "limit": 1000}
        ) as response:
            if response.status == 200:
                res_search = await response.json()
                items = res_search.get("items", [])
                data["detections_today"] = len(items)
                species_set = set(item.get("species") for item in items if item.get("species"))
                data["species_today"] = len(species_set)

        return data
