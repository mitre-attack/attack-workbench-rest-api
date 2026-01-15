const request = require('supertest');
const { expect } = require('expect');

const logger = require('../../../lib/logger');
logger.level = 'debug';

const config = require('../../../config/config');
const database = require('../../../lib/database-in-memory');
const databaseConfiguration = require('../../../lib/database-configuration');
const login = require('../../shared/login');

// modified and created properties will be set before calling REST API
const initialObjectData = {
  collection_index: {
    id: 'bb8c95c0-4e8f-491e-a3c9-8b4207e43041',
    name: 'MITRE ATT&CK',
    description: 'All ATT&CK datasets',
    collections: [
      {
        versions: [
          {
            url: 'https://raw.githubusercontent.com/mitre/cti/ATT%26CK-v8.0/enterprise-attack/enterprise-attack.json',
            version: '8.0.0',
            modified: '2020-10-27T08:51:03.896157Z',
            release_notes:
              "The October 2020 (v8) ATT&CK release updates Techniques, Groups, and Software for both Enterprise and Mobile. The biggest changes are the deprecation of the PRE-ATT&CK domain, the addition of two new Tactics to replace [PRE-ATT&CK](/versions/v7/matrices/pre/), and the addition of the Network platform to Enterprise ATT&CK.\n\nThis version of ATT&CK for Enterprise contains 14 Tactics, 177 Techniques, and 348 Sub-techniques.\n\n#### Retirement of PRE-ATT&CK\nThis release deprecates and removes the PRE-ATT&CK domain from ATT&CK, replacing its scope with two new Tactics in Enterprise ATT&CK [Reconnaissance](/tactics/TA0043/) and [Resource Development](/tactics/TA0042/). A new platform has also been added to ATT&CK to represent the environment these techniques occur in, [PRE](/matrices/enterprise/pre/). The previous contents of PRE-ATT&CK have been preserved [here](/versions/v7/matrices/pre/). See [the accompanying blog post](https://medium.com/mitre-attack/the-retirement-of-pre-attack-4b73ffecd3d3) for more details.\n\n#### New techniques in Reconnaissance:\n\n* [Active Scanning](/techniques/T1595)\n\t* [Scanning IP Blocks](/techniques/T1595/001)\n\t* [Vulnerability Scanning](/techniques/T1595/002)\n* [Gather Victim Host Information](/techniques/T1592)\n\t* [Client Configurations](/techniques/T1592/004)\n\t* [Firmware](/techniques/T1592/003)\n\t* [Hardware](/techniques/T1592/001)\n\t* [Software](/techniques/T1592/002)\n* [Gather Victim Identity Information](/techniques/T1589)\n\t* [Credentials](/techniques/T1589/001)\n\t* [Email Addresses](/techniques/T1589/002)\n\t* [Employee Names](/techniques/T1589/003)\n* [Gather Victim Network Information](/techniques/T1590)\n\t* [DNS](/techniques/T1590/002)\n\t* [Domain Properties](/techniques/T1590/001)\n\t* [IP Addresses](/techniques/T1590/005)\n\t* [Network Security Appliances](/techniques/T1590/006)\n\t* [Network Topology](/techniques/T1590/004)\n\t* [Network Trust Dependencies](/techniques/T1590/003)\n* [Gather Victim Org Information](/techniques/T1591)\n\t* [Business Relationships](/techniques/T1591/002)\n\t* [Determine Physical Locations](/techniques/T1591/001)\n\t* [Identify Business Tempo](/techniques/T1591/003)\n\t* [Identify Roles](/techniques/T1591/004)\n* [Phishing for Information](/techniques/T1598)\n\t* [Spearphishing Attachment](/techniques/T1598/002)\n\t* [Spearphishing Link](/techniques/T1598/003)\n\t* [Spearphishing Service](/techniques/T1598/001)\n* [Search Closed Sources](/techniques/T1597)\n\t* [Purchase Technical Data](/techniques/T1597/002)\n\t* [Threat Intel Vendors](/techniques/T1597/001)\n* [Search Open Technical Databases](/techniques/T1596)\n\t* [CDNs](/techniques/T1596/004)\n\t* [DNS/Passive DNS](/techniques/T1596/001)\n\t* [Digital Certificates](/techniques/T1596/003)\n\t* [Scan Databases](/techniques/T1596/005)\n\t* [WHOIS](/techniques/T1596/002)\n* [Search Open Websites/Domains](/techniques/T1593)\n\t* [Search Engines](/techniques/T1593/002)\n\t* [Social Media](/techniques/T1593/001)\n* [Search Victim-Owned Websites](/techniques/T1594)\n\n#### New techniques in Resource Development:\n\n* [Acquire Infrastructure](/techniques/T1583)\n\t* [Botnet](/techniques/T1583/005)\n\t* [DNS Server](/techniques/T1583/002)\n\t* [Domains](/techniques/T1583/001)\n\t* [Server](/techniques/T1583/004)\n\t* [Virtual Private Server](/techniques/T1583/003)\n\t* [Web Services](/techniques/T1583/006)\n* [Compromise Accounts](/techniques/T1586)\n\t* [Email Accounts](/techniques/T1586/002)\n\t* [Social Media Accounts](/techniques/T1586/001)\n* [Compromise Infrastructure](/techniques/T1584)\n\t* [Botnet](/techniques/T1584/005)\n\t* [DNS Server](/techniques/T1584/002)\n\t* [Domains](/techniques/T1584/001)\n\t* [Server](/techniques/T1584/004)\n\t* [Virtual Private Server](/techniques/T1584/003)\n\t* [Web Services](/techniques/T1584/006)\n* [Develop Capabilities](/techniques/T1587)\n\t* [Code Signing Certificates](/techniques/T1587/002)\n\t* [Digital Certificates](/techniques/T1587/003)\n\t* [Exploits](/techniques/T1587/004)\n\t* [Malware](/techniques/T1587/001)\n* [Establish Accounts](/techniques/T1585)\n\t* [Email Accounts](/techniques/T1585/002)\n\t* [Social Media Accounts](/techniques/T1585/001)\n* [Obtain Capabilities](/techniques/T1588)\n\t* [Code Signing Certificates](/techniques/T1588/003)\n\t* [Digital Certificates](/techniques/T1588/004)\n\t* [Exploits](/techniques/T1588/005)\n\t* [Malware](/techniques/T1588/001)\n\t* [Tool](/techniques/T1588/002)\n\t* [Vulnerabilities](/techniques/T1588/006)\n\n\n#### ATT&CK for Network Infrastructure Devices\n\n13 techniques and 15 sub-techniques have been added or modified to cover adversary behavior against network infrastructure devices that constitute the fabric of enterprises' networks such as switches and routers. These techniques are represented by a new platform in ATT&CK for Enterprise, [Network](/matrices/enterprise/network/).\n\n#### New and updated techniques for Network:\n* [Exploit Public-Facing Application](/techniques/T1190)\n* [Command and Scripting Interpreter](/techniques/T1059)\n\t* [Network Device CLI](/techniques/T1059/008)\n* [Pre-OS Boot](/techniques/T1542)\n\t* [ROMMONkit](/techniques/T1542/004)\n\t* [TFTP Boot](/techniques/T1542/005)\n* [Traffic Signaling](/techniques/T1205)\n\t* [Port Knocking](/techniques/T1205/001)\n* [Modify Authentication Process](/techniques/T1556)\n\t* [Network Device Authentication](/techniques/T1556/004)\n* [Modify System Image](/techniques/T1601)\n\t* [Downgrade System Image](/techniques/T1601/002)\n\t* [Patch System Image](/techniques/T1601/001)\n* [Network Boundary Bridging](/techniques/T1599)\n\t* [Network Address Translation Traversal](/techniques/T1599/001)\n* [Weaken Encryption](/techniques/T1600)\n\t* [Disable Crypto Hardware](/techniques/T1600/002)\n\t* [Reduce Key Space](/techniques/T1600/001)\n* [Data from Configuration Repository](/techniques/T1602)\n\t* [Network Device Configuration Dump](/techniques/T1602/002)\n\t* [SNMP (MIB Dump)](/techniques/T1602/001)\n* [Input Capture](/techniques/T1056)\n\t* [Keylogging](/techniques/T1056/001)\n* [Non-Application Layer Protocol](/techniques/T1095)\n* [Proxy](/techniques/T1090)\n\t* [Multi-hop Proxy](/techniques/T1090/003)\t\n* [Automated Exfiltration](/techniques/T1020)\n\t* [Traffic Duplication](/techniques/T1020/001)\n\n\nMany of the new Network techniques and sub-techniques focus on embedded network devices running closed source proprietary operating systems. This is largely driven by behaviors present in reported in the wild intrusions. Many newer devices leverage commodity embedded operating systems such as Linux or BSD variants, but accounts of adversary activity against these have been more sparse. However, network infrastructure devices running proprietary operating systems are still widely deployed on the Internet and within enterprises.\n\nWe will continue to build out additional Network techniques and sub-techniques as they become known. We welcome contributions and feedback from the community and look to improve this representation of behaviors in the network infrastructure devices space.\n\n### Techniques\n\n**Enterprise**\n\nWe also added 1 additional new technique and 7 sub-techniques to Enterprise in this ATT&CK release beyond the scope of the above updates. All Enterprise technique changes, including this new technique and these new sub-techniques, are documented below.\n\nNew Techniques:\n\n* [Acquire Infrastructure](/techniques/T1583)\n\t* [Botnet](/techniques/T1583/005)\n\t* [DNS Server](/techniques/T1583/002)\n\t* [Domains](/techniques/T1583/001)\n\t* [Server](/techniques/T1583/004)\n\t* [Virtual Private Server](/techniques/T1583/003)\n\t* [Web Services](/techniques/T1583/006)\n* [Active Scanning](/techniques/T1595)\n\t* [Scanning IP Blocks](/techniques/T1595/001)\n\t* [Vulnerability Scanning](/techniques/T1595/002)\n* Automated Exfiltration: [Traffic Duplication](/techniques/T1020/001)\n* Boot or Logon Autostart Execution: [Print Processors](/techniques/T1547/012)\n* [Cloud Infrastructure Discovery](/techniques/T1580)\n* Command and Scripting Interpreter: [Network Device CLI](/techniques/T1059/008)\n* [Compromise Accounts](/techniques/T1586)\n\t* [Email Accounts](/techniques/T1586/002)\n\t* [Social Media Accounts](/techniques/T1586/001)\n* [Compromise Infrastructure](/techniques/T1584)\n\t* [Botnet](/techniques/T1584/005)\n\t* [DNS Server](/techniques/T1584/002)\n\t* [Domains](/techniques/T1584/001)\n\t* [Server](/techniques/T1584/004)\n\t* [Virtual Private Server](/techniques/T1584/003)\n\t* [Web Services](/techniques/T1584/006)\n* [Data from Configuration Repository](/techniques/T1602)\n\t* [Network Device Configuration Dump](/techniques/T1602/002)\n\t* [SNMP (MIB Dump)](/techniques/T1602/001)\n* [Develop Capabilities](/techniques/T1587)\n\t* [Code Signing Certificates](/techniques/T1587/002)\n\t* [Digital Certificates](/techniques/T1587/003)\n\t* [Exploits](/techniques/T1587/004)\n\t* [Malware](/techniques/T1587/001)\n* [Establish Accounts](/techniques/T1585)\n\t* [Email Accounts](/techniques/T1585/002)\n\t* [Social Media Accounts](/techniques/T1585/001)\n* [Gather Victim Host Information](/techniques/T1592)\n\t* [Client Configurations](/techniques/T1592/004)\n\t* [Firmware](/techniques/T1592/003)\n\t* [Hardware](/techniques/T1592/001)\n\t* [Software](/techniques/T1592/002)\n* [Gather Victim Identity Information](/techniques/T1589)\n\t* [Credentials](/techniques/T1589/001)\n\t* [Email Addresses](/techniques/T1589/002)\n\t* [Employee Names](/techniques/T1589/003)\n* [Gather Victim Network Information](/techniques/T1590)\n\t* [DNS](/techniques/T1590/002)\n\t* [Domain Properties](/techniques/T1590/001)\n\t* [IP Addresses](/techniques/T1590/005)\n\t* [Network Security Appliances](/techniques/T1590/006)\n\t* [Network Topology](/techniques/T1590/004)\n\t* [Network Trust Dependencies](/techniques/T1590/003)\n* [Gather Victim Org Information](/techniques/T1591)\n\t* [Business Relationships](/techniques/T1591/002)\n\t* [Determine Physical Locations](/techniques/T1591/001)\n\t* [Identify Business Tempo](/techniques/T1591/003)\n\t* [Identify Roles](/techniques/T1591/004)\n* Hide Artifacts: [VBA Stomping](/techniques/T1564/007)\n* Impair Defenses: [Disable Cloud Logs](/techniques/T1562/008)\n* Man-in-the-Middle: [ARP Cache Poisoning](/techniques/T1557/002)\n* Modify Authentication Process: [Network Device Authentication](/techniques/T1556/004)\n* [Modify System Image](/techniques/T1601)\n\t* [Downgrade System Image](/techniques/T1601/002)\n\t* [Patch System Image](/techniques/T1601/001)\n* [Network Boundary Bridging](/techniques/T1599)\n\t* [Network Address Translation Traversal](/techniques/T1599/001)\n* [Obtain Capabilities](/techniques/T1588)\n\t* [Code Signing Certificates](/techniques/T1588/003)\n\t* [Digital Certificates](/techniques/T1588/004)\n\t* [Exploits](/techniques/T1588/005)\n\t* [Malware](/techniques/T1588/001)\n\t* [Tool](/techniques/T1588/002)\n\t* [Vulnerabilities](/techniques/T1588/006)\n* [Phishing for Information](/techniques/T1598)\n\t* [Spearphishing Attachment](/techniques/T1598/002)\n\t* [Spearphishing Link](/techniques/T1598/003)\n\t* [Spearphishing Service](/techniques/T1598/001)\n* Pre-OS Boot: [ROMMONkit](/techniques/T1542/004)\n* Pre-OS Boot: [TFTP Boot](/techniques/T1542/005)\n* Scheduled Task/Job: [Systemd Timers](/techniques/T1053/006)\n* [Search Closed Sources](/techniques/T1597)\n\t* [Purchase Technical Data](/techniques/T1597/002)\n\t* [Threat Intel Vendors](/techniques/T1597/001)\n* [Search Open Technical Databases](/techniques/T1596)\n\t* [CDNs](/techniques/T1596/004)\n\t* [DNS/Passive DNS](/techniques/T1596/001)\n\t* [Digital Certificates](/techniques/T1596/003)\n\t* [Scan Databases](/techniques/T1596/005)\n\t* [WHOIS](/techniques/T1596/002)\n* [Search Open Websites/Domains](/techniques/T1593)\n\t* [Search Engines](/techniques/T1593/002)\n\t* [Social Media](/techniques/T1593/001)\n* [Search Victim-Owned Websites](/techniques/T1594)\n* Signed Binary Proxy Execution: [Verclsid](/techniques/T1218/012)\n* Steal or Forge Kerberos Tickets: [AS-REP Roasting](/techniques/T1558/004)\n* [Weaken Encryption](/techniques/T1600)\n\t* [Disable Crypto Hardware](/techniques/T1600/002)\n\t* [Reduce Key Space](/techniques/T1600/001)\n\n\nTechnique changes:\n\n* Abuse Elevation Control Mechanism: [Bypass User Account Control](/techniques/T1548/002)\n* [Account Discovery](/techniques/T1087)\n\t* [Cloud Account](/techniques/T1087/004)\n* Account Manipulation: [Additional Cloud Credentials](/techniques/T1098/001)\n* [Automated Exfiltration](/techniques/T1020)\n* [Boot or Logon Autostart Execution](/techniques/T1547)\n\t* [Registry Run Keys / Startup Folder](/techniques/T1547/001)\n* [Boot or Logon Initialization Scripts](/techniques/T1037)\n* Brute Force: [Credential Stuffing](/techniques/T1110/004)\n* Brute Force: [Password Cracking](/techniques/T1110/002)\n* Brute Force: [Password Guessing](/techniques/T1110/001)\n* Brute Force: [Password Spraying](/techniques/T1110/003)\n* [Command and Scripting Interpreter](/techniques/T1059)\n\t* [AppleScript](/techniques/T1059/002)\n\t* [Visual Basic](/techniques/T1059/005)\n* Create or Modify System Process: [Launch Daemon](/techniques/T1543/004)\n* Create or Modify System Process: [Systemd Service](/techniques/T1543/002)\n* Create or Modify System Process: [Windows Service](/techniques/T1543/003)\n* [Data from Information Repositories](/techniques/T1213)\n* Endpoint Denial of Service: [OS Exhaustion Flood](/techniques/T1499/001)\n* Endpoint Denial of Service: [Service Exhaustion Flood](/techniques/T1499/002)\n* [Event Triggered Execution](/techniques/T1546)\n\t* [Image File Execution Options Injection](/techniques/T1546/012)\n* [Exploit Public-Facing Application](/techniques/T1190)\n* [File and Directory Discovery](/techniques/T1083)\n* File and Directory Permissions Modification: [Windows File and Directory Permissions Modification](/techniques/T1222/001)\n* [Hardware Additions](/techniques/T1200)\n* Hijack Execution Flow: [LD_PRELOAD](/techniques/T1574/006)\n* Hijack Execution Flow: [Path Interception by Unquoted Path](/techniques/T1574/009)\n* Impair Defenses: [Impair Command History Logging](/techniques/T1562/003)\n* Indicator Removal on Host: [Clear Command History](/techniques/T1070/003)\n* [Input Capture](/techniques/T1056)\n\t* [Keylogging](/techniques/T1056/001)\n* [Man-in-the-Middle](/techniques/T1557)\n* [Modify Authentication Process](/techniques/T1556)\n* [Modify Registry](/techniques/T1112)\n* Network Denial of Service: [Direct Network Flood](/techniques/T1498/001)\n* Network Denial of Service: [Reflection Amplification](/techniques/T1498/002)\n* [Network Share Discovery](/techniques/T1135)\n* [Non-Application Layer Protocol](/techniques/T1095)\n* Obfuscated Files or Information: [Binary Padding](/techniques/T1027/001)\n* Obfuscated Files or Information: [Steganography](/techniques/T1027/003)\n* [Password Policy Discovery](/techniques/T1201)\n* [Permission Groups Discovery](/techniques/T1069)\n\t* [Cloud Groups](/techniques/T1069/003)\n* [Phishing](/techniques/T1566)\n\t* [Spearphishing Attachment](/techniques/T1566/001)\n\t* [Spearphishing Link](/techniques/T1566/002)\n\t* [Spearphishing via Service](/techniques/T1566/003)\n* [Pre-OS Boot](/techniques/T1542)\n\t* [Bootkit](/techniques/T1542/003)\n* [Proxy](/techniques/T1090)\n\t* [Domain Fronting](/techniques/T1090/004)\n\t* [Multi-hop Proxy](/techniques/T1090/003)\n* [Remote System Discovery](/techniques/T1018)\n* Server Software Component: [Web Shell](/techniques/T1505/003)\n* [Service Stop](/techniques/T1489)\n* Signed Binary Proxy Execution: [Control Panel](/techniques/T1218/002)\n* [Software Deployment Tools](/techniques/T1072)\n* [Software Discovery](/techniques/T1518)\n\t* [Security Software Discovery](/techniques/T1518/001)\n* [Steal or Forge Kerberos Tickets](/techniques/T1558)\n\t* [Kerberoasting](/techniques/T1558/003)\n* [Traffic Signaling](/techniques/T1205)\n\t* [Port Knocking](/techniques/T1205/001)\n* [Unsecured Credentials](/techniques/T1552)\n\t* [Cloud Instance Metadata API](/techniques/T1552/005)\n* Use Alternate Authentication Material: [Application Access Token](/techniques/T1550/001)\n* Use Alternate Authentication Material: [Web Session Cookie](/techniques/T1550/004)\n* Valid Accounts: [Cloud Accounts](/techniques/T1078/004)\n* Valid Accounts: [Default Accounts](/techniques/T1078/001)\n* Valid Accounts: [Domain Accounts](/techniques/T1078/002)\n\n\nMinor Technique changes:\n\n* [Abuse Elevation Control Mechanism](/techniques/T1548)\n* [Account Manipulation](/techniques/T1098)\n* [Application Layer Protocol](/techniques/T1071)\n\t* [DNS](/techniques/T1071/004)\n\t* [File Transfer Protocols](/techniques/T1071/002)\n\t* [Mail Protocols](/techniques/T1071/003)\n* [Archive Collected Data](/techniques/T1560)\n* [Brute Force](/techniques/T1110)\n* [Create or Modify System Process](/techniques/T1543)\n* [Data Encrypted for Impact](/techniques/T1486)\n* [Data Staged](/techniques/T1074)\n\t* [Remote Data Staging](/techniques/T1074/002)\n* [Domain Trust Discovery](/techniques/T1482)\n* [Dynamic Resolution](/techniques/T1568)\n\t* [Domain Generation Algorithms](/techniques/T1568/002)\n* Email Collection: [Email Forwarding Rule](/techniques/T1114/003)\n* [Endpoint Denial of Service](/techniques/T1499)\n* [File and Directory Permissions Modification](/techniques/T1222)\n* [Hide Artifacts](/techniques/T1564)\n\t* [Hidden Users](/techniques/T1564/002)\n* [Hijack Execution Flow](/techniques/T1574)\n\t* [DLL Side-Loading](/techniques/T1574/002)\n\t* [Dylib Hijacking](/techniques/T1574/004)\n\t* [Path Interception by PATH Environment Variable](/techniques/T1574/007)\n\t* [Path Interception by Search Order Hijacking](/techniques/T1574/008)\n\t* [Services File Permissions Weakness](/techniques/T1574/010)\n\t* [Services Registry Permissions Weakness](/techniques/T1574/011)\n* [Impair Defenses](/techniques/T1562)\n\t* [Disable or Modify Cloud Firewall](/techniques/T1562/007)\n* [Indicator Removal on Host](/techniques/T1070)\n* [Internal Spearphishing](/techniques/T1534)\n* Modify Authentication Process: [Domain Controller Authentication](/techniques/T1556/001)\n* [Modify Cloud Compute Infrastructure](/techniques/T1578)\n\t* [Create Cloud Instance](/techniques/T1578/002)\n\t* [Create Snapshot](/techniques/T1578/001)\n\t* [Delete Cloud Instance](/techniques/T1578/003)\n* [Network Denial of Service](/techniques/T1498)\n* [Obfuscated Files or Information](/techniques/T1027)\n* [Scheduled Task/Job](/techniques/T1053)\n* [Server Software Component](/techniques/T1505)\n* [Signed Binary Proxy Execution](/techniques/T1218)\n* [Supply Chain Compromise](/techniques/T1195)\n* [Use Alternate Authentication Material](/techniques/T1550)\n* [Valid Accounts](/techniques/T1078)\n\n\nTechnique revocations:\nNo changes\n\nTechnique deprecations:\nNo changes\n\n**Mobile**\n\nNew Techniques:\n\n* [Geofencing](/techniques/T1581)\n* [SMS Control](/techniques/T1582)\n\n\nTechnique changes:\n\n* [Delete Device Data](/techniques/T1447)\n* [Supply Chain Compromise](/techniques/T1474)\n* [URI Hijacking](/techniques/T1416)\n\n\nMinor Technique changes:\nNo changes\n\nTechnique revocations:\n\n* URL Scheme Hijacking (revoked by [URI Hijacking](/techniques/T1416))\n\n\nTechnique deprecations:\nNo changes\n\n### Software\n\n**Enterprise**\n\nNew Software:\n\n* [Anchor](/software/S0504)\n* [Bonadan](/software/S0486)\n* [Carberp](/software/S0484)\n* [CookieMiner](/software/S0492)\n* [CrackMapExec](/software/S0488)\n* [Cryptoistic](/software/S0498)\n* [Dacls](/software/S0497)\n* [Drovorub](/software/S0502)\n* [FatDuke](/software/S0512)\n* [FrameworkPOS](/software/S0503)\n* [GoldenSpy](/software/S0493)\n* [Hancitor](/software/S0499)\n* [IcedID](/software/S0483)\n* [Kessel](/software/S0487)\n* [MCMD](/software/S0500)\n* [Ngrok](/software/S0508)\n* [Pillowmint](/software/S0517)\n* [PipeMon](/software/S0501)\n* [PolyglotDuke](/software/S0518)\n* [RDAT](/software/S0495)\n* [REvil](/software/S0496)\n* [RegDuke](/software/S0511)\n* [SYNful Knock](/software/S0519)\n* [SoreFang](/software/S0516)\n* [StrongPity](/software/S0491)\n* [WellMail](/software/S0515)\n* [WellMess](/software/S0514)\n\n\nSoftware changes:\n\n* [BADNEWS](/software/S0128)\n* [Cobalt Strike](/software/S0154)\n* [Ebury](/software/S0377)\n* [Emotet](/software/S0367)\n* [InvisiMole](/software/S0260)\n* [KONNI](/software/S0356)\n* [LoudMiner](/software/S0451)\n* [Machete](/software/S0409)\n* [Maze](/software/S0449)\n* [Metamorfo](/software/S0455)\n* [MiniDuke](/software/S0051)\n* [NETWIRE](/software/S0198)\n* [OnionDuke](/software/S0052)\n* [SDelete](/software/S0195)\n* [TrickBot](/software/S0266)\n* [Trojan.Karagany](/software/S0094)\n* [Valak](/software/S0476)\n* [WEBC2](/software/S0109)\n* [gh0st RAT](/software/S0032)\n* [njRAT](/software/S0385)\n\n\nMinor Software changes:\n\n* [HiddenWasp](/software/S0394)\n* [JPIN](/software/S0201)\n* [OSX/Shlayer](/software/S0402)\n* [RATANKBA](/software/S0241)\n* [pwdump](/software/S0006)\n\n\nSoftware revocations:\nNo changes\n\nSoftware deprecations:\nNo changes\n\nSoftware deletions:\n\n* Twitoor\n\n\n**Mobile**\n\nNew Software:\n\n* [Desert Scorpion](/software/S0505)\n* [FakeSpy](/software/S0509)\n* [Mandrake](/software/S0485)\n* [Twitoor](/software/S0302)\n* [ViperRAT](/software/S0506)\n* [WolfRAT](/software/S0489)\n* [XLoader for iOS](/software/S0490)\n* [Zen](/software/S0494)\n* [eSurv](/software/S0507)\n\n\nSoftware changes:\n\n* [Anubis](/software/S0422)\n* [Bread](/software/S0432)\n* [Cerberus](/software/S0480)\n* [Corona Updates](/software/S0425)\n* [Dendroid](/software/S0301)\n* [Ginp](/software/S0423)\n* [Rotexy](/software/S0411)\n* [Stealth Mango](/software/S0328)\n* [TrickMo](/software/S0427)\n* [XLoader for Android](/software/S0318)\n\n\nMinor Software changes:\nNo changes\n\nSoftware revocations:\nNo changes\n\nSoftware deprecations:\nNo changes\n\n### Groups\n\n**Enterprise**\n\nNew Groups:\n\n* [Bouncing Golf](/groups/G0097)\n* [Chimera](/groups/G0114)\n* [GOLD SOUTHFIELD](/groups/G0115)\n\n\nGroup changes:\n\n* [APT1](/groups/G0006)\n* [APT16](/groups/G0023)\n* [APT17](/groups/G0025)\n* [APT28](/groups/G0007)\n* [APT29](/groups/G0016)\n* [APT30](/groups/G0013)\n* [APT37](/groups/G0067)\n* [APT39](/groups/G0087)\n* [Cleaver](/groups/G0003)\n* [Dragonfly](/groups/G0035)\n* [Dragonfly 2.0](/groups/G0074)\n* [FIN6](/groups/G0037)\n* [FIN7](/groups/G0046)\n* [Gamaredon Group](/groups/G0047)\n* [Lazarus Group](/groups/G0032)\n* [Machete](/groups/G0095)\n* [MuddyWater](/groups/G0069)\n* [Night Dragon](/groups/G0014)\n* [OilRig](/groups/G0049)\n* [PROMETHIUM](/groups/G0056)\n* [Patchwork](/groups/G0040)\n* [TEMP.Veles](/groups/G0088)\n* [Turla](/groups/G0010)\n* [Winnti Group](/groups/G0044)\n* [Wizard Spider](/groups/G0102)\n* [menuPass](/groups/G0045)\n\n\nMinor Group changes:\n\n* [APT-C-36](/groups/G0099)\n* [Honeybee](/groups/G0072)\n\n\nGroup revocations:\nNo changes\n\nGroup deprecations:\nNo changes\n\n**Mobile**\n\nNew Groups:\nNo changes\n\nGroup changes:\n\n* [APT28](/groups/G0007)\n\n\nMinor Group changes:\nNo changes\n\nGroup revocations:\nNo changes\n\nGroup deprecations:\nNo changes\n\n### Mitigations\n\n**Enterprise**\n\nNew Mitigations:\n\n* [Pre-compromise](/mitigations/M1056)\n\n\nMitigation changes:\n\n* [User Training](/mitigations/M1017)\n\n\nMinor Mitigation changes:\nNo changes\n\nMitigation revocations:\nNo changes\n\nMitigation deprecations:\nNo changes\n\n**Mobile**\n\nNew Mitigations:\nNo changes\n\nMitigation changes:\nNo changes\n\nMinor Mitigation changes:\nNo changes\n\nMitigation revocations:\nNo changes\n\nMitigation deprecations:\nNo changes\n",
          },
          {
            url: 'https://raw.githubusercontent.com/mitre/cti/ATT%26CK-v7.2/enterprise-attack/enterprise-attack.json',
            version: '7.2.0',
            modified: '2020-07-15T10:41:41.536219Z',
          },
        ],
        description: 'The Enterprise domain of the ATT&CK dataset',
        created: '2018-01-16T19:15:30.610172Z',
        id: 'x-mitre-collection--0bbd7841-f053-471a-9900-da4af02e40c2',
        name: 'Enterprise ATT&CK',
      },
      {
        versions: [
          {
            url: 'https://raw.githubusercontent.com/mitre/cti/ATT%26CK-v8.0/mobile-attack/mobile-attack.json',
            version: '8.0.0',
            modified: '2020-10-27T08:51:03.896157Z',
          },
        ],
        description: 'The Mobile domain of the ATT&CK dataset',
        created: '2018-01-16T19:15:30.610172Z',
        id: 'x-mitre-collection--915b6504-bde8-40b5-bfda-0c3ecb46a9b9',
        name: 'Mobile ATT&CK',
      },
    ],
  },
  workspace: {
    remote_url: 'https://raw.githubusercontent.com/mitre/cti/ATT%26CK-v8.0/collection_index.json',
    update_policy: {
      automatic: true,
      interval: 300,
      last_retrieval: '2020-11-23T13:35:54.375623Z',
      subscriptions: ['x-mitre-collection--0bbd7841-f053-471a-9900-da4af02e40c2'],
    },
  },
};

describe('Collection Indexes Basic API', function () {
  let app;
  let passportCookie;

  before(async function () {
    // Establish the database connection
    // Use an in-memory database that we spin up for the test
    await database.initializeConnection();

    // Check for a valid database configuration
    await databaseConfiguration.checkSystemConfiguration();

    // Disable ADM validation for tests
    config.validateRequests.withAttackDataModel = false;
    config.validateRequests.withOpenApi = true;

    // Initialize the express app
    app = await require('../../../index').initializeApp();

    // Log into the app
    passportCookie = await login.loginAnonymous(app);
  });

  it('GET /api/collection-indexes returns an empty array', function (done) {
    request(app)
      .get('/api/collection-indexes')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/)
      .end(function (err, res) {
        if (err) {
          done(err);
        } else {
          // We expect to get an empty array
          const collectionIndexes = res.body;
          expect(collectionIndexes).toBeDefined();
          expect(Array.isArray(collectionIndexes)).toBe(true);
          expect(collectionIndexes.length).toBe(0);
          done();
        }
      });
  });

  it('POST /api/collection-indexes does not create an empty collection index', async function () {
    const body = {};
    await request(app)
      .post('/api/collection-indexes')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(400);
  });

  let collectionIndex1;
  it('POST /api/collection-indexes creates a collection index', async function () {
    const timestamp = new Date().toISOString();
    initialObjectData.collection_index.created = timestamp;
    initialObjectData.collection_index.modified = timestamp;
    const body = initialObjectData;
    const res = await request(app)
      .post('/api/collection-indexes')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(201)
      .expect('Content-Type', /json/);

    // We expect to get the created collection index
    collectionIndex1 = res.body;
    expect(collectionIndex1).toBeDefined();
    expect(collectionIndex1.collection_index).toBeDefined();
    expect(collectionIndex1.collection_index.id).toBeDefined();
    expect(collectionIndex1.collection_index.created).toBeDefined();
    expect(collectionIndex1.collection_index.modified).toBeDefined();
  });

  it('GET /api/collection-indexes returns the added collection index', async function () {
    const res = await request(app)
      .get('/api/collection-indexes')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one collection index in an array
    const collectionIndexes = res.body;
    expect(collectionIndexes).toBeDefined();
    expect(Array.isArray(collectionIndexes)).toBe(true);
    expect(collectionIndexes.length).toBe(1);
  });

  it('GET /api/collection-indexes/:id should not return a collection index when the id cannot be found', async function () {
    await request(app)
      .get('/api/collection-indexes/not-an-id')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(404);
  });

  it('GET /api/collection-indexes/:id returns the added collection index', async function () {
    const res = await request(app)
      .get('/api/collection-indexes/' + collectionIndex1.collection_index.id)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get one collection index
    const collectionIndex = res.body;
    expect(collectionIndex).toBeDefined();
    expect(collectionIndex.collection_index.id).toBe(collectionIndex1.collection_index.id);
    expect(collectionIndex.collection_index.name).toBe(collectionIndex1.collection_index.name);
    expect(collectionIndex.collection_index.description).toBe(
      collectionIndex1.collection_index.description,
    );
  });

  it('PUT /api/collection-indexes updates a collection index', async function () {
    const timestamp = new Date().toISOString();
    collectionIndex1.collection_index.modified = timestamp;
    collectionIndex1.collection_index.description = 'This is an updated collection index.';
    const body = collectionIndex1;
    const res = await request(app)
      .put('/api/collection-indexes/' + collectionIndex1.collection_index.id)
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get the updated collection index
    const collectionIndex = res.body;
    expect(collectionIndex).toBeDefined();
    expect(collectionIndex.collection_index.id).toBe(collectionIndex1.collection_index.id);
    expect(collectionIndex.collection_index.modified).toBe(
      collectionIndex1.collection_index.modified,
    );
  });

  it('POST /api/collection-indexes does not create a collection index with the same id', async function () {
    const body = collectionIndex1;
    await request(app)
      .post('/api/collection-indexes')
      .send(body)
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(409);
  });

  it('DELETE /api/collection-indexes deletes a collection index', async function () {
    await request(app)
      .delete('/api/collection-indexes/' + collectionIndex1.collection_index.id)
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(204);
  });

  it('GET /api/collection-indexes returns an empty array of collection indexes', async function () {
    const res = await request(app)
      .get('/api/collection-indexes')
      .set('Accept', 'application/json')
      .set('Cookie', `${login.passportCookieName}=${passportCookie.value}`)
      .expect(200)
      .expect('Content-Type', /json/);

    // We expect to get an empty array
    const collectionIndexes = res.body;
    expect(collectionIndexes).toBeDefined();
    expect(Array.isArray(collectionIndexes)).toBe(true);
    expect(collectionIndexes.length).toBe(0);
  });

  after(async function () {
    await database.closeConnection();
  });
});
