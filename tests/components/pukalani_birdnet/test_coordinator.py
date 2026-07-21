from unittest.mock import patch, AsyncMock
from datetime import datetime
import pytest
from homeassistant.helpers.update_coordinator import UpdateFailed
from homeassistant.core import HomeAssistant
from custom_components.pukalani_birdnet.coordinator import BirdNetCoordinator

@pytest.fixture
def coordinator(hass: HomeAssistant):
    return BirdNetCoordinator(hass, "http://127.0.0.1:8080")

@pytest.mark.asyncio
async def test_coordinator_fetch_success(coordinator):
    with patch("custom_components.pukalani_birdnet.coordinator.async_get_clientsession") as mock_session:
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.json.return_value = {"items": [{"species": "TestBird", "confidence": 0.95}]}
        mock_session.return_value.get.return_value.__aenter__.return_value = mock_response
        mock_session.return_value.post.return_value.__aenter__.return_value = mock_response
        
        coordinator.session = mock_session.return_value
        data = await coordinator._fetch_data()
        
        assert data["last_species"] == "TestBird"
        assert data["last_confidence"] == 95.0
