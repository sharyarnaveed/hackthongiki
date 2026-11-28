// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Remix resolves these imports from npm automatically.
import "@openzeppelin/contracts@5.1.0/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts@5.1.0/access/Ownable.sol";
import "@openzeppelin/contracts@5.1.0/utils/ReentrancyGuard.sol";

/**
 * @title TheSpace office decor
 * @notice NFT decor for TheSpace offices (plants, lamps, a fireplace…), with a
 *         shop and a marketplace in one contract.
 *
 *  - Shop: the app adds catalog items with a price. Anyone buys one for that
 *    price in AVAX and gets a freshly minted decor NFT.
 *  - Marketplace: holders list a decor NFT for a price; the contract holds it
 *    until someone buys it (the seller is paid in the same transaction) or the
 *    seller cancels.
 *
 * The backend reads this contract to show the shop, listings and who owns what,
 * and only lets an office show decor its owner's wallet really holds.
 */
contract OfficeDecor is ERC721, Ownable, ReentrancyGuard {
    struct Item {
        string name; // "Golden Monstera"
        string kind; // office furniture it looks like: "plant", "lamp", "fireplace"…
        uint256 price; // in wei
        bool forSale;
    }

    struct Listing {
        address seller;
        uint256 price; // in wei; 0 = not listed
    }

    Item[] private _items;
    /// tokenId => catalog item it was minted from.
    mapping(uint256 => uint256) public itemOf;
    /// tokenId => open marketplace listing (the contract holds the token meanwhile).
    mapping(uint256 => Listing) public listings;
    /// Next token id to mint (ids start at 1).
    uint256 public nextTokenId = 1;
    string private _baseTokenURI;

    event ItemAdded(uint256 indexed itemId, string name, string kind, uint256 price);
    event ItemUpdated(uint256 indexed itemId, uint256 price, bool forSale);
    event Bought(uint256 indexed tokenId, uint256 indexed itemId, address indexed buyer, uint256 price);
    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event Unlisted(uint256 indexed tokenId, address indexed seller);
    event Sold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price);

    error UnknownItem(uint256 itemId);
    error NotForSale(uint256 itemId);
    error WrongPayment(uint256 expected, uint256 sent);
    error NotYourToken(uint256 tokenId);
    error NotListed(uint256 tokenId);
    error ZeroPrice();
    error PaymentFailed();

    /// @param app TheSpace backend wallet: manages the catalog and collects shop sales.
    constructor(address app) ERC721("TheSpace Decor", "DECOR") Ownable(app) {}

    // ---------------------------------------------------------------- shop (app)

    function addItem(string calldata name, string calldata kind, uint256 price) external onlyOwner returns (uint256 itemId) {
        if (price == 0) revert ZeroPrice();
        itemId = _items.length;
        _items.push(Item(name, kind, price, true));
        emit ItemAdded(itemId, name, kind, price);
    }

    function updateItem(uint256 itemId, uint256 price, bool forSale) external onlyOwner {
        if (itemId >= _items.length) revert UnknownItem(itemId);
        if (price == 0) revert ZeroPrice();
        _items[itemId].price = price;
        _items[itemId].forSale = forSale;
        emit ItemUpdated(itemId, price, forSale);
    }

    /// Send shop sales to `to`. (Marketplace payments go straight to sellers and never stay here.)
    function withdraw(address payable to) external onlyOwner {
        (bool ok, ) = to.call{value: address(this).balance}("");
        if (!ok) revert PaymentFailed();
    }

    function setBaseURI(string calldata base) external onlyOwner {
        _baseTokenURI = base;
    }

    // ---------------------------------------------------------------- shop (anyone)

    /// Buy a new decor NFT from the catalog. Send exactly its price.
    function buy(uint256 itemId) external payable nonReentrant returns (uint256 tokenId) {
        if (itemId >= _items.length) revert UnknownItem(itemId);
        Item storage it = _items[itemId];
        if (!it.forSale) revert NotForSale(itemId);
        if (msg.value != it.price) revert WrongPayment(it.price, msg.value);
        tokenId = nextTokenId++;
        itemOf[tokenId] = itemId;
        _mint(msg.sender, tokenId);
        emit Bought(tokenId, itemId, msg.sender, msg.value);
    }

    // ---------------------------------------------------------------- marketplace

    /// Put your decor NFT up for sale. The contract holds it until it's sold or you cancel.
    function list(uint256 tokenId, uint256 price) external {
        if (ownerOf(tokenId) != msg.sender) revert NotYourToken(tokenId);
        if (price == 0) revert ZeroPrice();
        listings[tokenId] = Listing(msg.sender, price);
        _transfer(msg.sender, address(this), tokenId);
        emit Listed(tokenId, msg.sender, price);
    }

    /// Take your listing down and get the NFT back.
    function cancel(uint256 tokenId) external {
        Listing memory l = listings[tokenId];
        if (l.price == 0) revert NotListed(tokenId);
        if (l.seller != msg.sender) revert NotYourToken(tokenId);
        delete listings[tokenId];
        _transfer(address(this), msg.sender, tokenId);
        emit Unlisted(tokenId, msg.sender);
    }

    /// Buy a listed NFT. Send exactly its price; the seller is paid at once.
    function buyListing(uint256 tokenId) external payable nonReentrant {
        Listing memory l = listings[tokenId];
        if (l.price == 0) revert NotListed(tokenId);
        if (msg.value != l.price) revert WrongPayment(l.price, msg.value);
        delete listings[tokenId];
        _transfer(address(this), msg.sender, tokenId);
        (bool ok, ) = payable(l.seller).call{value: msg.value}("");
        if (!ok) revert PaymentFailed();
        emit Sold(tokenId, l.seller, msg.sender, msg.value);
    }

    // ---------------------------------------------------------------- views

    function itemCount() external view returns (uint256) {
        return _items.length;
    }

    function item(uint256 itemId) external view returns (string memory name, string memory kind, uint256 price, bool forSale) {
        if (itemId >= _items.length) revert UnknownItem(itemId);
        Item storage i = _items[itemId];
        return (i.name, i.kind, i.price, i.forSale);
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }
}
