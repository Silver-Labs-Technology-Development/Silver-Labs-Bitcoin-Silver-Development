// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// BSNA-FTS1 — Bitcoin Silver Native Assets, Fungible Token Standard 1.
///
/// Reference implementation of `docs/BSNA-FTS1-PROPOSAL.md` revision 1.
///
/// This contract is intentionally standalone. It is not BSNA-20, it does not
/// inherit an upgrade proxy, and it takes no fee inside transfers. Every amount
/// is an atomic unit; no argument is scaled by `10 ** decimals`.
///
/// It is not a bridge, not a gas asset, and not a claim that a token is backed
/// by L1 BTCS. Deploying it on BTCS L2 does not create supply on any other
/// network.
contract BSNAFTS1 {
    uint8 public constant SUPPLY_FIXED = 0;
    uint8 public constant SUPPLY_AUTHORIZED_MINT = 1;
    uint8 public constant BURN_DISABLED = 0;
    uint8 public constant BURN_HOLDER = 1;
    uint8 public constant PAUSE_DISABLED = 0;
    uint8 public constant PAUSE_ADMIN = 1;

    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public admin;
    address public minter;

    uint8 public immutable supplyPolicy;
    uint8 public immutable burnPolicy;
    uint8 public immutable pausePolicy;
    uint256 public immutable maxSupply;
    bool public immutable metadataMutable;

    string public metadataURI;
    bytes32 public metadataHash;
    bool public paused;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);
    event MinterUpdated(address indexed previousMinter, address indexed newMinter);
    event MetadataUpdated(string uri, bytes32 hash);
    event PauseUpdated(bool paused);

    error ZeroAddress();
    error EmptyNameOrSymbol();
    error NameOrSymbolTooLong();
    error DecimalsOutOfRange();
    error InvalidSupplyPolicy();
    error InvalidPolicy();
    error FixedSupplyCapMismatch();
    error InitialSupplyExceedsCap();
    error MetadataHashRequired();
    error InsufficientBalance(address account, uint256 balance, uint256 needed);
    error InsufficientAllowance(address spender, uint256 allowance, uint256 needed);
    error SupplyCapExceeded(uint256 supply, uint256 amount, uint256 cap);
    error MintDisabled();
    error BurnDisabled();
    error Paused();
    error NotAdmin(address caller);
    error NotMinter(address caller);
    error MetadataFrozen();
    error AmountZero();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin(msg.sender);
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    constructor(
        string memory tokenName,
        string memory tokenSymbol,
        uint8 tokenDecimals,
        uint256 initialSupply,
        uint256 cap,
        uint8 chosenSupplyPolicy,
        uint8 chosenBurnPolicy,
        uint8 chosenPausePolicy,
        bool mutableMetadata,
        string memory uri,
        bytes32 hash,
        address initialAdmin
    ) {
        if (initialAdmin == address(0)) revert ZeroAddress();
        bytes memory nameBytes = bytes(tokenName);
        bytes memory symbolBytes = bytes(tokenSymbol);
        if (nameBytes.length == 0 || symbolBytes.length == 0) revert EmptyNameOrSymbol();
        if (nameBytes.length > 64 || symbolBytes.length > 64) revert NameOrSymbolTooLong();
        if (tokenDecimals > 18) revert DecimalsOutOfRange();
        if (chosenSupplyPolicy != SUPPLY_FIXED && chosenSupplyPolicy != SUPPLY_AUTHORIZED_MINT) {
            revert InvalidSupplyPolicy();
        }
        if (chosenBurnPolicy != BURN_DISABLED && chosenBurnPolicy != BURN_HOLDER) revert InvalidPolicy();
        if (chosenPausePolicy != PAUSE_DISABLED && chosenPausePolicy != PAUSE_ADMIN) revert InvalidPolicy();
        if (chosenSupplyPolicy == SUPPLY_FIXED) {
            if (cap != initialSupply) revert FixedSupplyCapMismatch();
        } else if (cap != 0 && cap < initialSupply) {
            revert InitialSupplyExceedsCap();
        }
        if (bytes(uri).length != 0 && hash == bytes32(0)) revert MetadataHashRequired();

        name = tokenName;
        symbol = tokenSymbol;
        decimals = tokenDecimals;
        supplyPolicy = chosenSupplyPolicy;
        burnPolicy = chosenBurnPolicy;
        pausePolicy = chosenPausePolicy;
        maxSupply = cap;
        metadataMutable = mutableMetadata;
        admin = initialAdmin;
        metadataURI = uri;
        metadataHash = hash;

        if (initialSupply != 0) {
            totalSupply = initialSupply;
            balanceOf[initialAdmin] = initialSupply;
            emit Transfer(address(0), initialAdmin, initialSupply);
        }
    }

    function bsnaStandard() external pure returns (string memory) {
        return "BSNA-FTS1";
    }

    function bsnaVersion() external pure returns (string memory) {
        return "1";
    }

    function transfer(address to, uint256 value) external whenNotPaused returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external whenNotPaused returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < value) revert InsufficientAllowance(msg.sender, allowed, value);
        allowance[from][msg.sender] = allowed - value;
        _transfer(from, to, value);
        return true;
    }

    function mint(address to, uint256 amount) external whenNotPaused {
        if (supplyPolicy != SUPPLY_AUTHORIZED_MINT) revert MintDisabled();
        if (minter == address(0) || msg.sender != minter) revert NotMinter(msg.sender);
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert AmountZero();
        uint256 nextSupply = totalSupply + amount;
        if (maxSupply != 0 && nextSupply > maxSupply) {
            revert SupplyCapExceeded(totalSupply, amount, maxSupply);
        }
        totalSupply = nextSupply;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function burn(uint256 amount) external whenNotPaused {
        if (burnPolicy != BURN_HOLDER) revert BurnDisabled();
        if (amount == 0) revert AmountZero();
        uint256 balance = balanceOf[msg.sender];
        if (balance < amount) revert InsufficientBalance(msg.sender, balance, amount);
        balanceOf[msg.sender] = balance - amount;
        totalSupply -= amount;
        emit Transfer(msg.sender, address(0), amount);
    }

    function pause() external onlyAdmin {
        if (pausePolicy != PAUSE_ADMIN) revert InvalidPolicy();
        paused = true;
        emit PauseUpdated(true);
    }

    function unpause() external onlyAdmin {
        if (pausePolicy != PAUSE_ADMIN) revert InvalidPolicy();
        paused = false;
        emit PauseUpdated(false);
    }

    function setMinter(address nextMinter) external onlyAdmin {
        if (supplyPolicy != SUPPLY_AUTHORIZED_MINT) revert MintDisabled();
        if (nextMinter == address(0)) revert ZeroAddress();
        address previous = minter;
        minter = nextMinter;
        emit MinterUpdated(previous, nextMinter);
    }

    function transferAdmin(address nextAdmin) external onlyAdmin {
        if (nextAdmin == address(0)) revert ZeroAddress();
        address previous = admin;
        admin = nextAdmin;
        emit AdminTransferred(previous, nextAdmin);
    }

    function renounceAdmin() external onlyAdmin {
        address previous = admin;
        admin = address(0);
        emit AdminTransferred(previous, address(0));
    }

    function setMetadata(string calldata uri, bytes32 hash) external onlyAdmin {
        if (!metadataMutable) revert MetadataFrozen();
        if (bytes(uri).length != 0 && hash == bytes32(0)) revert MetadataHashRequired();
        metadataURI = uri;
        metadataHash = hash;
        emit MetadataUpdated(uri, hash);
    }

    function _transfer(address from, address to, uint256 value) private {
        if (to == address(0)) revert ZeroAddress();
        uint256 fromBalance = balanceOf[from];
        if (fromBalance < value) revert InsufficientBalance(from, fromBalance, value);
        balanceOf[from] = fromBalance - value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
