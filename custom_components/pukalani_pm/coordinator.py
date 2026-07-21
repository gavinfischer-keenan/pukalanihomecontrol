import logging
import async_timeout
from datetime import datetime, timezone
import zoneinfo
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from .const import DOMAIN, UPDATE_INTERVAL, CONF_API_URL

_LOGGER = logging.getLogger(__name__)
TZ_HONOLULU = zoneinfo.ZoneInfo("Pacific/Honolulu")

class PukalaniPMCoordinator(DataUpdateCoordinator):
    def __init__(self, hass, entry):
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=UPDATE_INTERVAL,
        )
        self.entry = entry
        self.api_url = entry.data[CONF_API_URL]
        self.session = async_get_clientsession(hass)

    def count_tasks(self, tasks):
        total = 0
        active = 0
        overdue = 0
        now = datetime.now(TZ_HONOLULU)
        
        for task in tasks:
            total += 1
            if task.get("status") != "Completed":
                active += 1
                
                target_date = task.get("target_date_finish")
                if target_date:
                    try:
                        # assuming YYYY-MM-DD
                        td = datetime.fromisoformat(target_date[:10])
                        td = td.replace(tzinfo=TZ_HONOLULU)
                        if td < now:
                            overdue += 1
                    except ValueError:
                        pass
                        
            if "children" in task and task["children"]:
                t, a, o = self.count_tasks(task["children"])
                total += t
                active += a
                overdue += o
        return total, active, overdue

    async def _async_update_data(self):
        data = {
            "api_online": False,
            "total_tasks": 0,
            "active_tasks": 0,
            "overdue_tasks": 0,
            "total_vendors": 0,
            "total_assets": 0,
            "warranties_expiring": 0
        }
        
        try:
            async with async_timeout.timeout(10):
                health_resp = await self.session.get(f"{self.api_url}/api/health")
                if health_resp.status == 200:
                    data["api_online"] = True
                
                tasks_resp = await self.session.get(f"{self.api_url}/api/tasks")
                if tasks_resp.status == 200:
                    tasks = await tasks_resp.json()
                    t, a, o = self.count_tasks(tasks)
                    data["total_tasks"] = t
                    data["active_tasks"] = a
                    data["overdue_tasks"] = o
                    
                vendors_resp = await self.session.get(f"{self.api_url}/api/vendors")
                if vendors_resp.status == 200:
                    vendors = await vendors_resp.json()
                    data["total_vendors"] = len(vendors)
                    
                try:
                    assets_resp = await self.session.get(f"{self.api_url}/api/assets")
                    if assets_resp.status == 200:
                        assets = await assets_resp.json()
                        data["total_assets"] = len(assets)
                except Exception:
                    pass

                try:
                    warranties_resp = await self.session.get(f"{self.api_url}/api/warranties")
                    if warranties_resp.status == 200:
                        warranties = await warranties_resp.json()
                        expiring = 0
                        now = datetime.now(TZ_HONOLULU)
                        for w in warranties:
                            exp_date = w.get("expiration_date")
                            if exp_date:
                                try:
                                    ed = datetime.fromisoformat(exp_date[:10]).replace(tzinfo=TZ_HONOLULU)
                                    if (ed - now).days <= 30 and (ed - now).days >= 0:
                                        expiring += 1
                                except ValueError:
                                    pass
                        data["warranties_expiring"] = expiring
                except Exception:
                    pass
                    
        except Exception as err:
            _LOGGER.error(f"Error communicating with PM API: {err}")
            
        return data
