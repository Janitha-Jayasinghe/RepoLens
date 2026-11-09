"""Production contract, security headers and public-only endpoint coverage."""
import asyncio
import httpx
import pytest
from backend.main import app
from backend.tests.test_api import request, repository

@pytest.mark.parametrize('endpoint', ['/api/analyze', '/api/languages', '/api/contributors', '/api/commits', '/api/issues', '/api/pull-requests', '/api/work-items/summary', '/api/health', '/api/snapshot'])
def test_every_analytics_endpoint_rejects_private_metadata(endpoint):
    result = request('owner/repo', lambda _: httpx.Response(200, json={**repository(), 'private': True}), endpoint=endpoint)
    assert result.status_code == 404
    assert result.headers['Cache-Control'] == 'no-store'


def test_security_headers_and_root_contract():
    result = request()
    assert result.status_code == 200
    assert result.headers['X-Content-Type-Options'] == 'nosniff'
    assert result.headers['X-Frame-Options'] == 'DENY'
    assert result.headers['Referrer-Policy'] == 'no-referrer'
    assert result.json()['message'] == 'RepoLens API is running!'


def test_openapi_documents_all_public_routes_without_credentials():
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            return await client.get('/openapi.json')
    response = asyncio.run(run())
    assert response.status_code == 200
    paths = response.json()['paths']
    assert len(paths) == 11
    assert '/api/reports/{snapshot_id}.pdf' in paths
    for path in paths.values():
        for operation in path.values():
            assert all(p['name'].lower() not in ('token', 'github_token', 'authorization') for p in operation.get('parameters', []))


def test_untrusted_origin_cannot_read_api():
    result = request(headers={'Origin': 'https://untrusted.example'})
    assert 'access-control-allow-origin' not in result.headers


def test_server_token_is_confined_to_upstream_headers(monkeypatch):
    from contextlib import aclosing
    from backend.main import github_client
    secret = 'test-only-never-a-real-token'
    monkeypatch.setenv('GITHUB_TOKEN', secret)
    async def run():
        async with aclosing(github_client()) as generator:
            client = await anext(generator)
            assert client.base_url == 'https://api.github.com'
            assert client.headers['Authorization'] == 'Bearer ' + secret
            assert secret not in str(client.base_url)
    asyncio.run(run())
    result = request('owner/repo', lambda _: httpx.Response(401, json={'message': secret}))
    assert secret not in result.text
    assert 'authorization' not in result.headers
