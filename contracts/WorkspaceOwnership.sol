// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Remix resolves these imports from npm automatically.
import "@openzeppelin/contracts@5.1.0/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts@5.1.0/access/Ownable.sol";

/**
 * @title TheSpace workspace ownership
 * @notice Each TheSpace workspace (office) has exactly one token here. Whoever
 *         holds the token owns the workspace; sending it to another member
 *         transfers the workspace.
 *
 * Roles
 *  - The contract owner ("app") is TheSpace's backend wallet. It mints a token
 *    when a workspace is created, keeps it in custody while the workspace owner
 *    has no wallet linked, and mirrors ownership transfers made inside the app.
 *  - Token holders are workspace owners with a linked wallet. They can send the
 *    token, but only to wallets the app has approved for that workspace (its
 *    members' linked wallets), so the chain and the app always agree.
 *
 * Token id = the workspace's database id (a 24-hex-digit MongoDB ObjectId read
 * as a number), so anyone can map a token to its workspace.
 */
contract WorkspaceOwnership is ERC721, Ownable {
    /// tokenId => wallet => may receive this token.
    mapping(uint256 => mapping(address => bool)) private _allowed;
    string private _baseTokenURI;

    event RecipientAllowed(uint256 indexed tokenId, address indexed wallet, bool allowed);

    /// The wallet isn't a member of this workspace (as approved by the app).
    error RecipientNotMember(uint256 tokenId, address to);

    /// @param app TheSpace backend wallet: mints, holds tokens in custody, and syncs transfers.
    constructor(address app) ERC721("TheSpace Workspace", "SPACE") Ownable(app) {}

    // ---------------------------------------------------------------- app only

    /// Mint a new workspace's token into the app's custody.
    function mint(uint256 tokenId) external onlyOwner {
        _mint(owner(), tokenId);
    }

    /// Approve (or revoke) wallets that may receive this workspace's token: its members' linked wallets.
    function setAllowed(uint256 tokenId, address[] calldata wallets, bool allowed) external onlyOwner {
        for (uint256 i = 0; i < wallets.length; i++) {
            _allowed[tokenId][wallets[i]] = allowed;
            emit RecipientAllowed(tokenId, wallets[i], allowed);
        }
    }

    /**
     * Move the token to match the app: an ownership transfer made in the app,
     * the owner linking a wallet (custody -> wallet), or unlinking it (wallet -> custody).
     */
    function syncTransfer(uint256 tokenId, address to) external onlyOwner {
        _requireOwned(tokenId);
        // auth = 0: the app may move it without the holder's approval.
        _update(to, tokenId, address(0));
    }

    /// The workspace was deleted.
    function burn(uint256 tokenId) external onlyOwner {
        _burn(tokenId);
    }

    /// Where token metadata lives, e.g. "https://api.example.com/api/nft/" (tokenURI = base + id).
    function setBaseURI(string calldata base) external onlyOwner {
        _baseTokenURI = base;
    }

    // ---------------------------------------------------------------- views

    function isAllowed(uint256 tokenId, address wallet) external view returns (bool) {
        return _allowed[tokenId][wallet];
    }

    /// Whether a token exists (minted and not burned).
    function exists(uint256 tokenId) external view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }

    // ---------------------------------------------------------------- internals

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    /// Every mint, transfer and burn passes here: holders may only send to approved members (or back to the app).
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        bool isTransfer = from != address(0) && to != address(0);
        if (isTransfer && msg.sender != owner() && to != owner() && !_allowed[tokenId][to]) {
            revert RecipientNotMember(tokenId, to);
        }
        return super._update(to, tokenId, auth);
    }
}
