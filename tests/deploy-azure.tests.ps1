#requires -Version 7.4
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\scripts\deploy-azure.ps1')

function Assert-Test([bool] $Condition, [string] $Message) {
    if (-not $Condition) { throw "TEST FAILED: $Message" }
}
function Assert-Throws([scriptblock] $Action, [string] $Message) {
    $caught = $false
    try { & $Action } catch {
        $caught = $true
        if ($_.Exception.Message -notlike "*$Message*") { throw }
    }
    Assert-Test $caught "Expected rejection containing: $Message"
}

$temporary = Join-Path ([IO.Path]::GetTempPath()) "bricklab-deploy-tests-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
    $revision = 'b' * 40
    $packagePath = Join-Path $temporary 'release.zip'
    $files = @{
        'package.json' = '{"scripts":{"start":"node server.mjs --production"}}'
        'server.mjs' = "console.log('fixture');"
        'src/windows-copilot-job-runner.mjs' = 'export {};'
        'scripts/windows-copilot-job-host.ps1' = 'exit 0'
        'dist/index.html' = '<html>fixture</html>'
        'dist/release.json' = (@{ revision = $revision } | ConvertTo-Json -Compress)
        'dist/assets/app.js' = 'export {};'
        'dist/assets/voice.mjs' = 'export {};'
        'dist/assets/runtime.wasm' = 'fixture'
        'node_modules/@azure/identity/package.json' = '{}'
        'node_modules/@azure/storage-blob/package.json' = '{}'
        'node_modules/jose/package.json' = '{}'
    }
    $archive = [IO.Compression.ZipFile]::Open($packagePath, [IO.Compression.ZipArchiveMode]::Create)
    $manifestFiles = @()
    try {
        foreach ($name in $files.Keys) {
            $content = [Text.Encoding]::UTF8.GetBytes($files[$name])
            $manifestFiles += @{ path = $name; size = $content.Length
                sha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($content)).ToLowerInvariant() }
            $stream = $archive.CreateEntry($name).Open()
            try { $stream.Write($content) } finally { $stream.Dispose() }
        }
        $writer = [IO.StreamWriter]::new($archive.CreateEntry('release-manifest.json').Open())
        try { $writer.Write((@{ revision = $revision; fileCount = $manifestFiles.Count; files = $manifestFiles } | ConvertTo-Json -Depth 5)) }
        finally { $writer.Dispose() }
    } finally { $archive.Dispose() }

    $script:settings = @{
        HOST = '0.0.0.0'; BRICKLAB_HOSTED = '1'; BRICKLAB_HOSTED_ORIGIN = 'https://bricklab-test.azurewebsites.net'
        BRICKLAB_AZURE_AI = '1'; AZURE_OPENAI_DEPLOYMENT = 'bricklab-planner-terra'
        AZURE_STORAGE_ACCOUNT = 'bricklabtest'; BRICKLAB_AZURE_BUDGET_CONTAINER = 'legacy-budget'
        BRICKLAB_AZURE_DAILY_CALLS = '50'; BRICKLAB_PLANNING_CONCURRENCY = '20'; BRICKLAB_PROVIDER_CONCURRENCY = '20'
        WEBSITE_RUN_FROM_PACKAGE = 'https://bricklabtest.blob.core.windows.net/packages/old.zip'
        WEBSITE_RUN_FROM_PACKAGE_BLOB_MI_RESOURCE_ID = 'SystemAssigned'
        UNRELATED_SECRET = 'never-print-this-value'
    }
    $original = $script:settings.Clone()
    $script:config = @{
        ftpsState = 'Disabled'; linuxFxVersion = 'NODE|24-lts'; appCommandLine = 'npm start'
        minTlsVersion = '1.2'; numberOfWorkers = 1
        ipSecurityRestrictionsDefaultAction = 'Deny'; scmIpSecurityRestrictionsDefaultAction = 'Deny'
        scmIpSecurityRestrictionsUseMain = $false; scmIpSecurityRestrictions = @(@{ action = 'Deny' })
        ipSecurityRestrictions = @(@{ action = 'Allow'; ipAddress = '203.0.113.7/32' })
    }
    $script:calls = [Collections.Generic.List[object]]::new()
    $script:blobExists = $false
    $script:active = 0
    $script:wrongAccount = $false
    $script:groupExists = $false
    $script:groupManaged = $true
    $script:provisionStorageBlocked = $false
    $script:planWorkers = 1
    $script:deploymentSucceeded = $false
    $script:tamperedBlob = $false
    function Invoke-RestMethod { return @{ hosted = $true; planningCapacity = @{ active = $script:active; quarantined = $false } } }
    function Invoke-Azure {
        param([string[]] $Arguments, [switch] $Json)
        $script:calls.Add($Arguments)
        switch ($Arguments[0..1] -join ' ') {
            'account show' { return @{ id = $(if ($script:wrongAccount) { 'wrong' } else { '11111111-1111-1111-1111-111111111111' })
                tenantId = '33333333-3333-3333-3333-333333333333'; environmentName = 'AzureCloud' } }
            'group exists' { return $script:groupExists }
            'group create' { return }
            'group show' { return @{ tags = @{ 'bricklab-installation' = $(if ($script:groupManaged) { 'deploy-azure-v1' } else { 'not-ours' }) } } }
            'resource list' { return @() }
            'deployment group' {
                if ($Arguments[2] -eq 'list') {
                    if ($script:deploymentSucceeded) {
                        return @(@{ name = 'bricklab-installation'; properties = @{ provisioningState = 'Succeeded' } })
                    }
                    return @()
                }
                if ($Arguments[2] -eq 'create') { return }
                return @{ properties = @{ outputs = @{
                    webAppName = @{ value = 'bricklab-test' }; storageAccountName = @{ value = 'bricklabtest' }
                    origin = @{ value = 'https://bricklab-test.azurewebsites.net' }
                } } }
            }
            'webapp show' { return @{ httpsOnly = $true; identity = @{ type = 'SystemAssigned'; principalId = 'identity' }
                appServicePlanId = '/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/rg-bricklab-test/providers/Microsoft.Web/serverfarms/bricklab-plan'
                virtualNetworkSubnetId = 'subnet-id' } }
            'appservice plan' { return @{ sku = @{ capacity = $script:planWorkers } } }
            'webapp restart' { return }
            'webapp config' {
                if ($Arguments[2] -eq 'show') { return $script:config }
                if ($Arguments[3] -eq 'list') {
                    return @($script:settings.GetEnumerator() | ForEach-Object { @{ name = $_.Key; value = $_.Value } })
                }
                if ($Arguments[3] -eq 'set') {
                    $start = [array]::IndexOf($Arguments, '--settings') + 1
                    foreach ($setting in $Arguments[$start..($Arguments.Length - 1)]) {
                        $pair = $setting -split '=', 2
                        $script:settings[$pair[0]] = $pair[1]
                    }
                    return
                }
            }
            'storage account' {
                if ($Arguments -contains 'show' -and $script:inProvision) {
                    return @{ publicNetworkAccess = $(if ($script:provisionStorageBlocked) { 'Disabled' } else { 'Enabled' })
                        allowSharedKeyAccess = $false; allowBlobPublicAccess = $false; enableHttpsTrafficOnly = $true
                        networkRuleSet = @{ defaultAction = 'Deny'; bypass = 'None'
                            ipRules = @(@{ ipAddressOrRange = '203.0.113.7' })
                            virtualNetworkRules = @(@{ virtualNetworkResourceId = 'subnet-id' }) } }
                }
                return @{ publicNetworkAccess = 'Disabled'; allowSharedKeyAccess = $false; allowBlobPublicAccess = $false; enableHttpsTrafficOnly = $true }
            }
            'storage container' { return @{ properties = @{ publicAccess = $null } } }
            'storage blob' {
                if ($Arguments[2] -eq 'exists') { return @{ exists = ($Arguments -contains 'packages' -and $script:blobExists) } }
                if ($Arguments[2] -eq 'upload') {
                    if ($Arguments -contains 'packages') { $script:blobExists = $true }
                    return
                }
                if ($Arguments[2] -eq 'show') {
                    return @{ metadata = @{ sha256 = (Get-FileHash $packagePath -Algorithm SHA256).Hash.ToLowerInvariant() }
                        properties = @{ contentLength = (Get-Item $packagePath).Length } }
                }
                if ($Arguments[2] -eq 'download') {
                    Copy-Item -LiteralPath $packagePath -Destination $Arguments[([array]::IndexOf($Arguments, '--file') + 1)] -Force
                    if ($script:tamperedBlob) {
                        [IO.File]::AppendAllText($Arguments[([array]::IndexOf($Arguments, '--file') + 1)], 'tampered')
                    }
                    return
                }
            }
        }
        throw "Unexpected mocked command: $($Arguments -join ' ')"
    }
    $options = @{
        Operation = 'Deploy'; SubscriptionId = '11111111-1111-1111-1111-111111111111'; ResourceGroup = 'rg-bricklab-test'
        TenantId = '33333333-3333-3333-3333-333333333333'
        OperatorIpv4Cidr = '203.0.113.7/32'; WebAppName = 'bricklab-test'; StorageAccountName = 'bricklabtest'
        PackagePath = $packagePath; Revision = $revision; MaintenanceConfirmed = $true; InitializeNewInstallation = $false
    }
    $script:inProvision = $false
    Assert-Release $packagePath $revision
    $legacy = Join-Path $temporary 'legacy.zip'
    Copy-Item -LiteralPath $packagePath -Destination $legacy
    $legacyArchive = [IO.Compression.ZipFile]::Open($legacy, [IO.Compression.ZipArchiveMode]::Update)
    try {
        $legacyArchive.GetEntry('dist/release.json').Delete()
        $manifestEntry = $legacyArchive.GetEntry('release-manifest.json')
        $reader = [IO.StreamReader]::new($manifestEntry.Open())
        try { $legacyManifest = $reader.ReadToEnd() | ConvertFrom-Json -AsHashtable } finally { $reader.Dispose() }
        $legacyManifest.files = @($legacyManifest.files | Where-Object { $_.path -ne 'dist/release.json' })
        $legacyManifest.fileCount = $legacyManifest.files.Count
        $manifestEntry.Delete()
        $writer = [IO.StreamWriter]::new($legacyArchive.CreateEntry('release-manifest.json').Open())
        try { $writer.Write(($legacyManifest | ConvertTo-Json -Depth 5)) } finally { $writer.Dispose() }
    } finally { $legacyArchive.Dispose() }
    Assert-Release $legacy $revision
    Assert-Throws { Assert-Release $packagePath ('c' * 40) } 'mismatch'
    Assert-Throws { Assert-ExactOrigin 'https://example.com:443' } 'exact HTTPS'
    Assert-Throws { Assert-ExactOrigin 'https://example.com/' } 'exact HTTPS'
    Assert-Throws { Assert-OperatorIpv4 '0.0.0.0/0' } '/32'
    Assert-Throws { Assert-OperatorIpv4 '999.0.0.1/32' } '/32'

    $script:wrongAccount = $true
    Assert-Throws { Invoke-BrickLabDeployment $options } 'exact subscription'
    $script:wrongAccount = $false
    $script:active = 1
    Assert-Throws { Invoke-BrickLabDeployment $options } 'idle'
    $script:active = 0
    $script:config.scmIpSecurityRestrictionsUseMain = $true
    Assert-Throws { Invoke-BrickLabDeployment $options } 'default-deny'
    $script:config.scmIpSecurityRestrictionsUseMain = $false
    $script:planWorkers = 2
    Assert-Throws { Invoke-BrickLabDeployment $options } 'one App Service plan worker'
    $script:planWorkers = 1
    Assert-Test (-not @($script:calls | Where-Object { $_ -contains 'set' -or $_ -contains 'upload' }).Count) 'Rejected operations must not write'

    Invoke-BrickLabDeployment $options
    foreach ($key in $original.Keys) {
        if ($key -ne 'WEBSITE_RUN_FROM_PACKAGE') {
            Assert-Test ($script:settings[$key] -ceq $original[$key]) "Update preserves $key"
        }
    }
    Assert-Test ($script:settings.WEBSITE_RUN_FROM_PACKAGE -like "*/$revision-*.zip") 'Content-addressed package selected'
    $uploads = @($script:calls | Where-Object { $_ -contains 'upload' })
    Assert-Test ($uploads.Count -eq 1 -and $uploads[0] -contains '--if-none-match') 'Immutable conditional upload'
    Assert-Test (@($script:calls | Where-Object { $_ -contains 'daily-usage.json' -or $_ -contains 'daily-budget.json' }).Count -eq 0) 'Update never touches ledger'
    $script:calls.Clear()
    $script:tamperedBlob = $true
    Assert-Throws { Invoke-BrickLabDeployment $options } 'hash mismatch'
    Assert-Test (@($script:calls | Where-Object { $_ -contains 'restart' -or $_ -contains 'set' }).Count -eq 0) 'Tampered existing blob is not selected'
    $script:tamperedBlob = $false
    $script:calls.Clear()
    Invoke-BrickLabDeployment $options
    Assert-Test (@($script:calls | Where-Object { $_ -contains 'restart' -or $_ -contains 'set' }).Count -eq 0) 'Same package does not restart'
    $script:config.ipSecurityRestrictions += @{ action = 'Allow'; ipAddress = '203.0.113.8/32' }
    Assert-Throws { Invoke-BrickLabDeployment $options } 'explicit set'
    $options.OperatorIpv4Cidr = @('203.0.113.7/32', '203.0.113.8/32')
    Invoke-BrickLabDeployment $options
    $options.OperatorIpv4Cidr = @('203.0.113.7/32')
    $script:config.ipSecurityRestrictions = @($script:config.ipSecurityRestrictions[0])

    $script:calls.Clear()
    $initial = $options.Clone()
    $initial.InitializeNewInstallation = $true
    Assert-Throws { Invoke-BrickLabDeployment $initial } 'untouched'
    Assert-Test (@($script:calls | Where-Object { $_ -contains 'upload' -or $_ -contains 'set' }).Count -eq 0) 'Initialization rejects existing production configuration'
    $script:settings = @{ BRICKLAB_AZURE_AI = '0' }
    Invoke-BrickLabDeployment $initial
    Assert-Test ($script:settings.BRICKLAB_AZURE_USAGE_CONTAINER -eq 'usage') 'Initial ledger configured'
    Assert-Test ($script:settings.BRICKLAB_AZURE_AI -eq '0') 'Initial paid planning remains off'
    Assert-Test (@($script:calls | Where-Object { $_ -contains 'daily-usage.json' -and $_ -contains '--if-none-match' }).Count -eq 1) 'Initial ledger conditionally created once'

    $script:calls.Clear()
    $provision = @{
        Operation = 'Provision'; SubscriptionId = $options.SubscriptionId; TenantId = $options.TenantId; ResourceGroup = $options.ResourceGroup
        Location = 'italynorth'; OperatorIpv4Cidr = $options.OperatorIpv4Cidr
        UploaderObjectId = '22222222-2222-2222-2222-222222222222'; UploaderPrincipalType = 'ServicePrincipal'
    }
    $script:inProvision = $true
    $script:groupExists = $true
    $script:groupManaged = $false
    Assert-Throws { Invoke-BrickLabDeployment $provision } 'existing resource groups'
    Assert-Test (@($script:calls | Where-Object { $_ -contains 'create' }).Count -eq 0) 'Unmarked group is not modified'
    $script:groupExists = $false
    $script:groupManaged = $true
    Invoke-BrickLabDeployment $provision
    Assert-Test (@($script:calls | Where-Object { $_ -contains 'create' -and $_ -contains 'deployment' }).Count -eq 1) 'Provision deploys only isolated installation template'
    Assert-Test (@($script:calls | Where-Object { $_ -contains 'cognitiveservices' -or $_ -contains 'afd' -or $_ -contains 'dns' }).Count -eq 0) 'No model, edge or domain commands'
    $script:calls.Clear()
    $script:groupExists = $true
    $script:deploymentSucceeded = $true
    $script:settings.WEBSITE_RUN_FROM_PACKAGE = 'existing-initialized-package'
    Invoke-BrickLabDeployment $provision
    Assert-Test (@($script:calls | Where-Object { $_ -contains 'create' -or $_ -contains 'set' }).Count -eq 0) 'Completed provisioning is resume-only and never reapplies settings'
    $script:provisionStorageBlocked = $true
    Assert-Throws { Invoke-BrickLabDeployment $provision } 'possibly by Azure Policy'
    $provision.PrivateStorage = $true
    Invoke-BrickLabDeployment $provision
    Assert-Test (@($script:calls | Where-Object { $_ -contains 'bricklab-private-package' -and $_ -contains 'create' }).Count -eq 1) 'Private storage adds only the isolated endpoint stage'
    Write-Host 'PASS: offline release, target, boundary, idle, preservation, immutable rollout, initialization and provisioning tests.'
} finally {
    # Only this test's newly created, resolved temporary directory.
    Remove-Item -LiteralPath $temporary -Recurse -Force
}
