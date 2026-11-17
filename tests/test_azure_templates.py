import json
from pathlib import Path
import shutil
import subprocess
import unittest


@unittest.skipUnless(shutil.which("az"), "Azure CLI and its Bicep compiler are required")
class AzureTemplateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root = Path(__file__).resolve().parents[1]
        cls.templates = {}
        for name in ("azure", "edge", "installation"):
            result = subprocess.run(
                [shutil.which("az"), "bicep", "build", "--file",
                 str(root / "infra" / f"{name}.bicep"), "--stdout"],
                capture_output=True, text=True, check=True, timeout=60,
            )
            cls.templates[name] = json.loads(result.stdout)

    def resource(self, template, kind):
        return next(item for item in self.templates[template]["resources"]
                    if item["type"] == kind)

    def test_public_origin_allows_only_the_bound_front_door_and_denies_scm(self):
        web = self.resource("azure", "Microsoft.Web/sites")["properties"]
        site = web["siteConfig"]
        self.assertEqual(web["publicNetworkAccess"], "Enabled")
        self.assertEqual(site["ipSecurityRestrictionsDefaultAction"], "Deny")
        self.assertEqual(site["ipSecurityRestrictions"],
                         "[concat(if(empty(parameters('frontDoorId')), createArray(), "
                         "createArray(createObject('name', 'frontdoor-only', 'action', 'Allow', "
                         "'priority', 100, 'tag', 'ServiceTag', 'ipAddress', 'AzureFrontDoor.Backend', "
                         "'headers', createObject('x-azure-fdid', createArray(parameters('frontDoorId')))))), "
                         "createArray(createObject('name', 'deny-all', 'action', 'Deny', "
                         "'priority', 2147483647, 'ipAddress', 'Any')))]")
        self.assertFalse(site["scmIpSecurityRestrictionsUseMain"])
        self.assertEqual(site["scmIpSecurityRestrictionsDefaultAction"], "Deny")
        self.assertEqual(site["scmIpSecurityRestrictions"], [{
            "name": "deny-all", "action": "Deny", "priority": 2147483647, "ipAddress": "Any",
        }])
        origin = self.resource("edge", "Microsoft.Cdn/profiles/originGroups/origins")["properties"]
        self.assertNotIn("sharedPrivateLinkResource", origin)
        self.assertIn("defaultHostName", origin["hostName"])
        self.assertTrue(origin["enforceCertificateNameCheck"])

    def test_native_model_policy_is_attached_without_enabling_paid_planning(self):
        web = self.resource("azure", "Microsoft.Web/sites")["properties"]
        settings = {item["name"]: item["value"] for item in web["siteConfig"]["appSettings"]}
        model = self.resource("azure", "Microsoft.CognitiveServices/accounts/deployments")["properties"]
        self.assertIn("bricklab-public-safe", model["raiPolicyName"])
        self.assertEqual(settings["BRICKLAB_AZURE_AI"], "0")

    def test_isolated_installation_has_no_model_or_domain_and_restricted_networks(self):
        resources = self.templates["installation"]["resources"]
        self.assertFalse(any(item["type"].startswith(("Microsoft.CognitiveServices/", "Microsoft.Cdn/"))
                             for item in resources))
        web = self.resource("installation", "Microsoft.Web/sites")["properties"]
        site = web["siteConfig"]
        self.assertEqual(site["ipSecurityRestrictionsDefaultAction"], "Deny")
        self.assertEqual(site["ipSecurityRestrictions"][0]["ipAddress"],
                         "[parameters('operatorIpv4Cidr')]")
        self.assertFalse(site["scmIpSecurityRestrictionsUseMain"])
        self.assertEqual(site["scmIpSecurityRestrictionsDefaultAction"], "Deny")
        settings = {item["name"]: item["value"] for item in site["appSettings"]}
        self.assertEqual(settings["BRICKLAB_AZURE_AI"], "0")
        storage = self.resource("installation", "Microsoft.Storage/storageAccounts")["properties"]
        self.assertFalse(storage["allowSharedKeyAccess"])
        self.assertFalse(storage["allowBlobPublicAccess"])
        self.assertEqual(storage["networkAcls"]["defaultAction"], "Deny")
        self.assertEqual(storage["networkAcls"]["bypass"], "None")
        self.assertEqual(len(storage["networkAcls"]["ipRules"]), 1)
        self.assertEqual(len(storage["networkAcls"]["virtualNetworkRules"]), 1)


if __name__ == "__main__":
    unittest.main()
