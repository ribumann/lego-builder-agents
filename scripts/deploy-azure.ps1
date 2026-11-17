#requires -Version 7.4
[CmdletBinding()]
param(
    [ValidateSet('Provision', 'Deploy')][string] $Operation,
    [string] $SubscriptionId,
    [string] $TenantId,
    [string] $ResourceGroup,
    [string] $Location,
    [string[]] $OperatorIpv4Cidr,
    [switch] $PrivateStorage,
    [string] $UploaderObjectId,
    [ValidateSet('User', 'ServicePrincipal')][string] $UploaderPrincipalType = 'User',
    [string] $WebAppName,
    [string] $StorageAccountName,
    [string] $PackagePath,
    [string] $Revision,
    [switch] $InitializeNewInstallation,
    [switch] $MaintenanceConfirmed
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:RepositoryRoot = Split-Path $PSScriptRoot -Parent

function Invoke-Azure {
    param([string[]] $Arguments, [switch] $Json)
    # Never echo command output on failure: app settings can contain credentials.
    $result = & az @Arguments --only-show-errors --output $(if ($Json) { 'json' } else { 'none' }) 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Azure CLI operation failed ($($Arguments[0..1] -join ' ')); inspect Azure diagnostics securely. No retry was attempted." }
    if ($Json) {
        if (-not $result) { throw 'Azure CLI returned no JSON.' }
        return ($result -join "`n" | ConvertFrom-Json -AsHashtable)
    }
}

function Assert-Required {
    param([hashtable] $Values)
    foreach ($key in $Values.Keys) {
        if ([string]::IsNullOrWhiteSpace($Values[$key])) { throw "Missing required parameter: $key" }
    }
}

function Assert-ExactOrigin {
    param([string] $Origin)
    $uri = $null
    if (-not [uri]::TryCreate($Origin, [UriKind]::Absolute, [ref] $uri) -or
        $uri.Scheme -cne 'https' -or $uri.HostNameType -ne 'Dns' -or
        $uri.UserInfo -or $uri.Query -or $uri.Fragment -or
        $Origin -cne "https://$($uri.DnsSafeHost)") {
        throw 'Expected an exact HTTPS DNS origin without a port, path, credentials or trailing slash.'
    }
}

function Get-AppSettings {
    param([string[]] $Target)
    $values = Invoke-Azure (@('webapp', 'config', 'appsettings', 'list') + $Target) -Json
    $settings = @{}
    foreach ($item in $values) { $settings[$item.name] = [string] $item.value }
    return $settings
}

function Assert-OperatorIpv4 {
    param([string] $Cidr)
    $ip = $null
    if ($Cidr -notmatch '^(\d{1,3}\.){3}\d{1,3}/32$' -or
        -not [Net.IPAddress]::TryParse(($Cidr -split '/')[0], [ref] $ip) -or
        $ip.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
        throw 'OperatorIpv4Cidr must be one explicit IPv4 /32 address.'
    }
}

function Assert-DeploymentBoundary {
    param([hashtable] $Web, [hashtable] $Config, [hashtable] $Storage, [string[]] $OperatorCidr)
    if (-not $Web.identity.principalId -or $Web.identity.type -notmatch 'SystemAssigned' -or
        $Web.httpsOnly -ne $true -or $Config.ftpsState -ne 'Disabled' -or
        $Config.linuxFxVersion -ne 'NODE|24-lts' -or $Config.appCommandLine -ne 'npm start' -or
        $Config.numberOfWorkers -ne 1 -or $Config.minTlsVersion -notin @('1.2', '1.3')) {
        throw 'Expected HTTPS, system identity, Node 24, npm start, one worker and disabled FTP.'
    }
    if ($Storage.allowSharedKeyAccess -ne $false -or
        $Storage.allowBlobPublicAccess -ne $false -or $Storage.enableHttpsTrafficOnly -ne $true) {
        throw 'Storage must deny public blobs and shared keys, and require HTTPS.'
    }
    if ($Storage.publicNetworkAccess -ne 'Disabled') {
        foreach ($cidr in $OperatorCidr) { Assert-OperatorIpv4 $cidr }
        $storageIps = @($OperatorCidr | ForEach-Object { $_; ($_ -split '/')[0] })
        if ($Storage.networkRuleSet.defaultAction -ne 'Deny' -or $Storage.networkRuleSet.bypass -ne 'None' -or
            @($Storage.networkRuleSet.ipRules).Count -lt 1 -or
            @($Storage.networkRuleSet.ipRules | Where-Object { $_.ipAddressOrRange -notin $storageIps }).Count -or
            @($Storage.networkRuleSet.virtualNetworkRules).Count -ne 1 -or
            $Storage.networkRuleSet.virtualNetworkRules[0].virtualNetworkResourceId -ne $Web.virtualNetworkSubnetId -or
            ($Storage.networkRuleSet.ContainsKey('resourceAccessRules') -and @($Storage.networkRuleSet.resourceAccessRules | Where-Object { $null -ne $_ }).Count) -or
            ($Storage.networkRuleSet.ContainsKey('ipv6Rules') -and @($Storage.networkRuleSet.ipv6Rules).Count)) {
            throw 'Selected-network storage must allow only the operator /32 and the integrated app subnet.'
        }
    }
    if ($Config.ipSecurityRestrictionsDefaultAction -ne 'Deny' -or
        $Config.scmIpSecurityRestrictionsDefaultAction -ne 'Deny' -or
        $Config.scmIpSecurityRestrictionsUseMain -ne $false -or
        @($Config.scmIpSecurityRestrictions | Where-Object { $_.action -ne 'Deny' }).Count) {
        throw 'Origin and independent SCM default-deny protections are required.'
    }
    $allows = @($Config.ipSecurityRestrictions | Where-Object { $_.action -eq 'Allow' })
    if ($OperatorCidr) {
        foreach ($cidr in $OperatorCidr) { Assert-OperatorIpv4 $cidr }
        if ($OperatorCidr.Count -gt 3 -or @($OperatorCidr | Select-Object -Unique).Count -ne $OperatorCidr.Count -or
            $allows.Count -ne $OperatorCidr.Count -or
            @($allows | Where-Object { $_.ipAddress -notin $OperatorCidr }).Count) {
            throw 'App ingress must match the explicit set of at most three verified operator /32s.'
        }
        return
    }
    if ($allows.Count -ne 1 -or $allows[0].ipAddress -ne 'AzureFrontDoor.Backend' -or
        $allows[0].tag -ne 'ServiceTag' -or -not $allows[0].ContainsKey('headers') -or
        @($allows[0].headers['x-azure-fdid']).Count -ne 1 -or
        $allows[0].headers['x-azure-fdid'][0] -notmatch '^[0-9a-fA-F-]{36}$') {
        throw 'Only an exact Front Door backend service-tag and ID allow rule is supported.'
    }
}

function Assert-Release {
    param([string] $Path, [string] $ExpectedRevision)
    if ($ExpectedRevision -cnotmatch '^[0-9a-f]{40}$') { throw 'Revision must be a full lowercase Git SHA.' }
    Add-Type -AssemblyName System.IO.Compression
    $archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Path).Path)
    try {
        $names = @($archive.Entries | ForEach-Object { $_.FullName })
        if (@($names | Select-Object -Unique).Count -ne $names.Count -or
            @($names | Where-Object { $_ -match '(^/|\\|(^|/)\.\.(/|$))' }).Count) {
            throw 'Unsafe or duplicate package entries.'
        }
        $entry = $archive.GetEntry('release-manifest.json')
        if (-not $entry) { throw 'Missing release manifest.' }
        $reader = [IO.StreamReader]::new($entry.Open())
        try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json -AsHashtable } finally { $reader.Dispose() }
        if ($manifest.revision -cne $ExpectedRevision -or $manifest.fileCount -ne $manifest.files.Count -or
            $names.Count -ne ($manifest.files.Count + 1)) { throw 'Release manifest/revision mismatch.' }
        foreach ($required in @('package.json', 'server.mjs', 'dist/index.html', 'dist/release.json',
            'src/windows-copilot-job-runner.mjs', 'scripts/windows-copilot-job-host.ps1',
            'node_modules/@azure/identity/package.json', 'node_modules/@azure/storage-blob/package.json',
            'node_modules/jose/package.json')) {
            if ($required -notin $names) { throw "Missing release artifact: $required" }
        }
        $reader = [IO.StreamReader]::new($archive.GetEntry('dist/release.json').Open())
        try { $metadata = $reader.ReadToEnd() | ConvertFrom-Json -AsHashtable } finally { $reader.Dispose() }
        if ($metadata.revision -cne $ExpectedRevision) { throw 'Served release metadata/revision mismatch.' }
        if (-not @($names | Where-Object { $_ -match '^dist/.+\.wasm$' }).Count -or
            -not @($names | Where-Object { $_ -match '^dist/.+\.mjs$' }).Count -or
            -not @($names | Where-Object { $_ -match '^dist/.+\.js$' }).Count) {
            throw 'Missing browser, voice worker or WebAssembly assets.'
        }
        $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        foreach ($file in $manifest.files) {
            $item = $archive.GetEntry($file.path)
            if (-not $seen.Add($file.path) -or -not $item -or $item.Length -ne $file.size) { throw 'Invalid manifest entry.' }
            $stream = $item.Open()
            try { $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)).ToLowerInvariant() }
            finally { $stream.Dispose() }
            if ($hash -cne $file.sha256) { throw 'Release artifact hash mismatch.' }
        }
    } finally { $archive.Dispose() }
}

function Invoke-BrickLabDeployment {
    param([hashtable] $Options)
    if ($Options.OperatorIpv4Cidr) { $Options.OperatorIpv4Cidr = [string[]] @($Options.OperatorIpv4Cidr) }
    if (-not $Options.ContainsKey('PrivateStorage')) { $Options.PrivateStorage = $false }
    Assert-Required @{ Operation = $Options.Operation; SubscriptionId = $Options.SubscriptionId
        TenantId = $Options.TenantId; ResourceGroup = $Options.ResourceGroup }
    if ($Options.Operation -notin @('Provision', 'Deploy')) { throw 'Operation must be Provision or Deploy.' }
    if ($Options.SubscriptionId -notmatch '^[0-9a-fA-F-]{36}$' -or $Options.TenantId -notmatch '^[0-9a-fA-F-]{36}$' -or
        $Options.ResourceGroup -notmatch '^[a-zA-Z0-9_-]{1,90}$') { throw 'Invalid explicit Azure target.' }
    if ($Options.Operation -eq 'Provision') {
        Assert-Required @{ Location = $Options.Location; UploaderObjectId = $Options.UploaderObjectId }
        if (@($Options.OperatorIpv4Cidr).Count -ne 1) { throw 'Provision requires one initial operator /32.' }
        Assert-OperatorIpv4 $Options.OperatorIpv4Cidr[0]
        if ($Options.UploaderObjectId -notmatch '^[0-9a-fA-F-]{36}$') { throw 'Uploader must be an Entra object ID.' }
    } else {
        Assert-Required @{ WebAppName = $Options.WebAppName; StorageAccountName = $Options.StorageAccountName
            PackagePath = $Options.PackagePath; Revision = $Options.Revision }
        if ($Options.WebAppName -notmatch '^[a-zA-Z0-9-]{2,60}$' -or
            $Options.StorageAccountName -notmatch '^[a-z0-9]{3,24}$') { throw 'Invalid app or storage name.' }
        if (-not $Options.MaintenanceConfirmed) { throw 'MaintenanceConfirmed is required: prevent new submissions and drain active requests before rollout.' }
        Assert-Release $Options.PackagePath $Options.Revision
    }
    $account = Invoke-Azure @('account', 'show', '--subscription', $Options.SubscriptionId) -Json
    if ($account.id -ne $Options.SubscriptionId -or $account.tenantId -ne $Options.TenantId -or
        $account.environmentName -ne 'AzureCloud') {
        throw 'Sign in to the exact subscription in Azure public cloud before running.'
    }
    $scope = @('--subscription', $Options.SubscriptionId, '--resource-group', $Options.ResourceGroup)
    if ($Options.Operation -eq 'Provision') {
        $exists = Invoke-Azure @('group', 'exists', '--subscription', $Options.SubscriptionId, '--name', $Options.ResourceGroup) -Json
        if ($exists) {
            $group = Invoke-Azure @('group', 'show', '--subscription', $Options.SubscriptionId, '--name', $Options.ResourceGroup) -Json
            if (-not $group.tags -or $group.tags['bricklab-installation'] -ne 'deploy-azure-v1') {
                throw 'Provision refuses existing resource groups not created by this automation; never use it for an existing production app.'
            }
        } else {
            Invoke-Azure @('group', 'create', '--subscription', $Options.SubscriptionId, '--name', $Options.ResourceGroup,
                '--location', $Options.Location, '--tags', 'bricklab-installation=deploy-azure-v1')
        }
        $deployments = @(Invoke-Azure (@('deployment', 'group', 'list') + $scope) -Json)
        $name = 'bricklab-installation'
        $previous = @($deployments | Where-Object { $_.name -eq $name -and $_.properties.provisioningState -eq 'Succeeded' })
        if (-not $previous.Count) {
            $resources = @(Invoke-Azure (@('resource', 'list') + $scope + @('--resource-type', 'Microsoft.Web/sites')) -Json)
            foreach ($resource in $resources) {
                $settings = Get-AppSettings ($scope + @('--name', $resource.name))
                if ($settings['WEBSITE_RUN_FROM_PACKAGE'] -or $settings['BRICKLAB_AZURE_AI'] -ne '0') {
                    throw 'Refusing to reapply the installation template to an initialized or paid-enabled app.'
                }
            }
            $parameters = @("location=$($Options.Location)", "operatorIpv4Cidr=$($Options.OperatorIpv4Cidr[0])",
                "privateStorage=$(([bool]$Options.PrivateStorage).ToString().ToLowerInvariant())",
                "packageUploaderObjectId=$($Options.UploaderObjectId)",
                "packageUploaderPrincipalType=$($Options.UploaderPrincipalType)")
            Invoke-Azure (@('deployment', 'group', 'create') + $scope + @('--name', $name,
                '--mode', 'Incremental', '--template-file', (Join-Path $script:RepositoryRoot 'infra\installation.bicep'),
                '--parameters') + $parameters)
        }
        $record = Invoke-Azure (@('deployment', 'group', 'show') + $scope + @('--name', $name)) -Json
        $base = $record.properties.outputs
        Write-Host "Resources provisioned: app=$($base.webAppName.value), storage=$($base.storageAccountName.value)."
        if ($Options.PrivateStorage) {
            $privatePrevious = @($deployments | Where-Object { $_.name -eq 'bricklab-private-package' -and $_.properties.provisioningState -eq 'Succeeded' })
            if (-not $privatePrevious.Count) {
                Invoke-Azure (@('deployment', 'group', 'create') + $scope +
                    @('--name', 'bricklab-private-package', '--mode', 'Incremental', '--template-file',
                        (Join-Path $script:RepositoryRoot 'infra\installation-private-storage.bicep'), '--parameters',
                        "storageAccountName=$($base.storageAccountName.value)", "location=$($Options.Location)"))
            }
        }
        $actualStorage = Invoke-Azure (@('storage', 'account', 'show') + $scope +
            @('--name', $base.storageAccountName.value)) -Json
        if (-not $Options.PrivateStorage -and $actualStorage.publicNetworkAccess -ne 'Enabled') {
            throw 'Resources were provisioned and incur charges, but Storage public networking is disabled (possibly by Azure Policy). The selected-network profile cannot upload or fetch packages. Use an approved private-endpoint architecture/connected runner; never relax the policy.'
        }
        if ($Options.PrivateStorage -and $actualStorage.publicNetworkAccess -ne 'Disabled') {
            throw 'PrivateStorage requires the Storage public endpoint disabled; no policy relaxation is performed.'
        }
        $actualTarget = $scope + @('--name', $base.webAppName.value)
        $actualWeb = Invoke-Azure (@('webapp', 'show') + $actualTarget) -Json
        $actualConfig = Invoke-Azure (@('webapp', 'config', 'show') + $actualTarget) -Json
        Assert-DeploymentBoundary $actualWeb $actualConfig $actualStorage $Options.OperatorIpv4Cidr
        Write-Host "Default HTTPS origin=$($base.origin.value). Provision never enables planning or selects a package. Completed stages are not reconciled; run initial Deploy only for a new app."
        return
    }

    $target = $scope + @('--name', $Options.WebAppName)
    $web = Invoke-Azure (@('webapp', 'show') + $target) -Json
    $plan = Invoke-Azure @('appservice', 'plan', 'show', '--subscription', $Options.SubscriptionId, '--ids', $web.serverFarmId) -Json
    if ($plan.sku.capacity -ne 1) { throw 'Exactly one App Service plan worker is required.' }
    $config = Invoke-Azure (@('webapp', 'config', 'show') + $target) -Json
    $storage = Invoke-Azure (@('storage', 'account', 'show') + $scope + @('--name', $Options.StorageAccountName)) -Json
    $settings = Get-AppSettings $target
    $initial = [bool] $Options.InitializeNewInstallation
    Assert-DeploymentBoundary $web $config $storage $Options.OperatorIpv4Cidr
    foreach ($key in @('BRICKLAB_COPILOT', 'BRICKLAB_CODESPACES', 'BRICKLAB_LOCAL_AI', 'BRICKLAB_COMPATIBLE_AI')) {
        if ($settings[$key] -eq '1') { throw 'Unsafe hosted provider configuration; no deployment attempted.' }
    }
    $changes = @()
    if ($initial) {
        $group = Invoke-Azure @('group', 'show', '--subscription', $Options.SubscriptionId, '--name', $Options.ResourceGroup) -Json
        $record = Invoke-Azure (@('deployment', 'group', 'show') + $scope + @('--name', 'bricklab-installation')) -Json
        $base = $record.properties.outputs
        if (-not $group.tags -or $group.tags['bricklab-installation'] -ne 'deploy-azure-v1' -or
            $base.webAppName.value -ne $Options.WebAppName -or $base.storageAccountName.value -ne $Options.StorageAccountName -or
            $settings['BRICKLAB_AZURE_AI'] -ne '0' -or $settings['WEBSITE_RUN_FROM_PACKAGE'] -or
            $settings['BRICKLAB_AZURE_BUDGET_CONTAINER'] -or $settings['BRICKLAB_AZURE_USAGE_CONTAINER'] -or
            -not $Options.OperatorIpv4Cidr) {
            throw 'Initial setup requires an untouched automation-created app, paid OFF, no ledger aliases and operator-only ingress.'
        }
        Assert-ExactOrigin $base.origin.value
        $changes = @('HOST=0.0.0.0', 'BRICKLAB_HOSTED=1', "BRICKLAB_HOSTED_ORIGIN=$($base.origin.value)",
            "AZURE_STORAGE_ACCOUNT=$($Options.StorageAccountName)",
            'BRICKLAB_AZURE_USAGE_CONTAINER=usage')
    } else {
        if ($settings['BRICKLAB_HOSTED'] -ne '1' -or $settings['HOST'] -ne '0.0.0.0' -or
            $settings['AZURE_STORAGE_ACCOUNT'] -ne $Options.StorageAccountName -or
            -not ($settings['BRICKLAB_AZURE_BUDGET_CONTAINER'] -or $settings['BRICKLAB_AZURE_USAGE_CONTAINER'])) {
            throw 'Existing deployment must have hosted settings and its existing durable ledger configured.'
        }
        Assert-ExactOrigin $settings['BRICKLAB_HOSTED_ORIGIN']
        $status = Invoke-RestMethod -Uri "$($settings['BRICKLAB_HOSTED_ORIGIN'])/api/status" -TimeoutSec 30 -MaximumRedirection 0
        if ($status.hosted -ne $true -or $null -eq $status.planningCapacity.active -or
            $status.planningCapacity.active -ne 0 -or $status.planningCapacity.quarantined -ne $false) {
            throw 'Status must show a hosted, idle, non-quarantined app; no rollout attempted.'
        }
    }
    $blobScope = @('--subscription', $Options.SubscriptionId, '--auth-mode', 'login',
        '--account-name', $Options.StorageAccountName)
    $container = Invoke-Azure (@('storage', 'container', 'show') + $blobScope + @('--name', 'packages')) -Json
    if ($container.properties.publicAccess -notin @($null, 'None', 'Off')) { throw 'Package container is not private.' }
    if ($initial) {
        $ledger = Invoke-Azure (@('storage', 'blob', 'exists') + $blobScope +
            @('--container-name', 'usage', '--name', 'daily-usage.json')) -Json
        if (-not $ledger.exists) {
            $temporary = [IO.Path]::GetTempFileName()
            try {
                [IO.File]::WriteAllText($temporary, '{"day":"2000-01-01","count":0}')
                Invoke-Azure (@('storage', 'blob', 'upload') + $blobScope +
                    @('--container-name', 'usage', '--name', 'daily-usage.json', '--file', $temporary,
                        '--if-none-match', '*', '--overwrite', 'false'))
            } finally { Remove-Item -LiteralPath $temporary }
        }
    }
    $hash = (Get-FileHash -LiteralPath $Options.PackagePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $blobName = "$($Options.Revision)-$hash.zip"
    $url = "https://$($Options.StorageAccountName).blob.core.windows.net/packages/$blobName"
    $blob = Invoke-Azure (@('storage', 'blob', 'exists') + $blobScope + @('--container-name', 'packages', '--name', $blobName)) -Json
    if ($blob.exists) {
        $properties = Invoke-Azure (@('storage', 'blob', 'show') + $blobScope +
            @('--container-name', 'packages', '--name', $blobName)) -Json
        if ($properties.metadata['sha256'] -cne $hash -or
            $properties.properties.contentLength -ne (Get-Item -LiteralPath $Options.PackagePath).Length) {
            throw 'Existing immutable release does not match; no overwrite attempted.'
        }
        $download = [IO.Path]::GetTempFileName()
        try {
            Invoke-Azure (@('storage', 'blob', 'download') + $blobScope +
                @('--container-name', 'packages', '--name', $blobName, '--file', $download, '--overwrite', 'true'))
            if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant() -cne $hash) {
                throw 'Existing immutable release hash mismatch; no package selected.'
            }
        } finally { Remove-Item -LiteralPath $download }
    } else {
        Invoke-Azure (@('storage', 'blob', 'upload') + $blobScope + @('--container-name', 'packages', '--name', $blobName,
            '--file', $Options.PackagePath, '--if-none-match', '*', '--overwrite', 'false', '--metadata', "sha256=$hash"))
    }
    if ($settings['WEBSITE_RUN_FROM_PACKAGE'] -ceq $url -and
        $settings['WEBSITE_RUN_FROM_PACKAGE_BLOB_MI_RESOURCE_ID'] -ceq 'SystemAssigned') {
        Write-Host 'The exact immutable package is already selected; no settings changed or restart requested.'
        return
    }
    $changes += @("WEBSITE_RUN_FROM_PACKAGE=$url", 'WEBSITE_RUN_FROM_PACKAGE_BLOB_MI_RESOURCE_ID=SystemAssigned')
    Invoke-Azure (@('webapp', 'config', 'appsettings', 'set') + $target + @('--settings') + $changes)
    $selected = Get-AppSettings $target
    if ($selected['WEBSITE_RUN_FROM_PACKAGE'] -cne $url -or
        $selected['WEBSITE_RUN_FROM_PACKAGE_BLOB_MI_RESOURCE_ID'] -cne 'SystemAssigned') {
        throw 'Package pointer verification failed; inspect securely before retrying.'
    }
    foreach ($key in $settings.Keys) {
        if ($key -notin @($changes | ForEach-Object { ($_ -split '=', 2)[0] }) -and $selected[$key] -cne $settings[$key]) {
            throw 'An unrelated app setting changed during rollout; inspect securely before restoring traffic.'
        }
    }
    Invoke-Azure (@('webapp', 'restart') + $target)
    Write-Host "Package selected and restart requested: revision=$($Options.Revision), sha256=$hash."
    Write-Host 'This is not runtime acceptance. Verify HTTPS, assets and controls before restoring traffic; no inference was requested.'
}

if ($MyInvocation.InvocationName -ne '.') {
    Invoke-BrickLabDeployment @{
        Operation = $Operation; SubscriptionId = $SubscriptionId; TenantId = $TenantId; ResourceGroup = $ResourceGroup
        Location = $Location; OperatorIpv4Cidr = $OperatorIpv4Cidr; PrivateStorage = $PrivateStorage
        UploaderObjectId = $UploaderObjectId; UploaderPrincipalType = $UploaderPrincipalType
        WebAppName = $WebAppName; StorageAccountName = $StorageAccountName; PackagePath = $PackagePath
        Revision = $Revision; InitializeNewInstallation = $InitializeNewInstallation; MaintenanceConfirmed = $MaintenanceConfirmed
    }
}
